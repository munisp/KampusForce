import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, createHmac, randomInt } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  attributionRecords,
  auditLogs,
  campuses,
  deals,
  ledgerEntries,
  notificationDeliveries,
  payoutAttempts,
  payoutDestinations,
  payouts,
  products,
  reps,
  users,
} from "../db/schema";
import {
  dispatchDuePayouts,
  recordSandboxPayoutOutcome,
  recordVerifiedProviderPayoutOutcome,
  recoverInterruptedPayoutDispatches,
} from "../api/services/ledger";
import {
  configurePayoutDestination,
  payoutDestinationStatus,
  resolvePayoutDestination,
} from "../api/services/payoutDestinations";
import { ProviderPayoutError, type ProviderPayoutInput } from "../api/services/payoutProviders";
import { completeSyntheticIdentityWorkflow } from "../api/services/identityFixtures";
import { notifyUser } from "../api/services/notifications";
import { processDueNotificationDeliveries } from "../api/services/notificationDelivery";
import { healthRoutes } from "../api/routes/health";
import { runDurableJob } from "../api/services/jobs";
import { integrationConfiguration } from "../api/services/integrationConfig";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const phone = () => `+23494${String(randomInt(10000000, 99999999))}`;
const reference = (label: string) => `${label}_${suffix}`.slice(0, 50);
const accountNumber = "0123456789";
const envKeys = [
  "KF_PAYOUT_ENCRYPTION_KEY",
  "KF_PAYOUT_ENCRYPTION_KEY_VERSION",
  "KF_PROVIDER_MODE",
  "KF_LIVE_CUTOVER_AUTHORIZED",
  "KF_SANDBOX_MODE",
  "KF_APP_URL",
  "PAYSTACK_SECRET_KEY",
  "KF_NOTIFICATION_WEBHOOK_URL",
  "KF_NOTIFICATION_WEBHOOK_SECRET",
  "KF_NOTIFICATION_ALLOWED_HOSTS",
] as const;

async function makePayout(input: { repId: number; label: string; mode?: "sandbox" | "live"; state?: "queued" | "processing"; attempts?: number }) {
  const mode = input.mode || "live";
  const state = input.state || "queued";
  const attempts = input.attempts || 0;
  const [payout] = await db.insert(payouts).values({
    repId: input.repId,
    amountGrossKobo: 100_000,
    amountNetKobo: 90_000,
    withholdingKobo: 10_000,
    provider: mode === "live" ? "paystack" : "paystack_sandbox",
    providerRef: reference(`${input.label}_record`),
    executionMode: mode,
    state,
    batchId: reference(input.label),
    attempts,
  }).returning();
  return payout;
}

async function latestAttempt(payoutId: number) {
  const [attempt] = await db.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payoutId)).orderBy(desc(payoutAttempts.attemptNo)).limit(1);
  assert.ok(attempt);
  return attempt;
}

async function main() {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let isolatedQueuedPayouts: Array<{ id: number; nextRetryAt: Date | null }> = [];
  try {
    process.env.KF_PAYOUT_ENCRYPTION_KEY = "22".repeat(32);
    process.env.KF_PAYOUT_ENCRYPTION_KEY_VERSION = "acceptance-v1";
    process.env.KF_PROVIDER_MODE = "sandbox";
    process.env.KF_SANDBOX_MODE = "true";
    delete process.env.KF_LIVE_CUTOVER_AUTHORIZED;
    delete process.env.KF_NOTIFICATION_WEBHOOK_URL;
    delete process.env.KF_NOTIFICATION_WEBHOOK_SECRET;
    delete process.env.KF_NOTIFICATION_ALLOWED_HOSTS;

    // Earlier ordered journeys may intentionally leave due retries. Park only
    // those pre-existing schedules for this focused journey, then restore them.
    isolatedQueuedPayouts = await db.select({ id: payouts.id, nextRetryAt: payouts.nextRetryAt }).from(payouts).where(eq(payouts.state, "queued"));
    if (isolatedQueuedPayouts.length) {
      await db.update(payouts).set({ nextRetryAt: new Date("2099-01-01T00:00:00.000Z") })
        .where(inArray(payouts.id, isolatedQueuedPayouts.map((payout) => payout.id)));
    }

    const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
    assert.ok(campus);
    const [reviewer, repUser] = await db.insert(users).values([
      { phoneE164: phone(), name: "Production Gate Independent Reviewer", role: "ops" },
      { phoneE164: phone(), name: "Production Gate Rep", role: "rep", kycState: "verified", bankNameMatch: true, bankAccountName: "Production Gate Recipient", bankCode: "058" },
    ]).returning();
    const [rep] = await db.insert(reps).values({ userId: repUser.id, campusId: campus.id, code: `PG-${suffix.slice(0, 10)}`, status: "active" }).returning();
    await completeSyntheticIdentityWorkflow({
      caseType: "representative_kyc",
      subjectType: "user",
      subjectId: repUser.id,
      requestUserId: repUser.id,
      reviewerUserId: reviewer.id,
      campusId: campus.id,
    });

    const configured = await configurePayoutDestination(repUser.id, { accountNumber, bankCode: "058", accountName: "Production Gate Recipient" });
    assert.deepEqual(configured, { configured: true, bankCode: "058", accountName: "Production Gate Recipient", accountLast4: "6789", version: 1, fullAccountNumberPersisted: false });
    const status = await payoutDestinationStatus(repUser.id);
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify(status).includes(accountNumber));
    assert.deepEqual(await resolvePayoutDestination(repUser.id), { accountNumber, bankCode: "058", accountName: "Production Gate Recipient" });
    const [destination] = await db.select().from(payoutDestinations).where(eq(payoutDestinations.userId, repUser.id)).limit(1);
    assert.ok(destination);
    assert.ok(!JSON.stringify(destination).includes(accountNumber));
    const destinationAudits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "payout_destination"), eq(auditLogs.entityId, String(repUser.id))));
    assert.ok(!JSON.stringify(destinationAudits).includes(accountNumber));

    const tampered = Buffer.from(destination.accountNumberCiphertext, "base64");
    tampered[0] = tampered[0] ^ 1;
    await db.update(payoutDestinations).set({ accountNumberCiphertext: tampered.toString("base64") }).where(eq(payoutDestinations.userId, repUser.id));
    await assert.rejects(() => resolvePayoutDestination(repUser.id));
    await db.update(payoutDestinations).set({ accountNumberCiphertext: destination.accountNumberCiphertext }).where(eq(payoutDestinations.userId, repUser.id));
    process.env.KF_PAYOUT_ENCRYPTION_KEY = "33".repeat(32);
    await assert.rejects(() => resolvePayoutDestination(repUser.id));
    process.env.KF_PAYOUT_ENCRYPTION_KEY = "22".repeat(32);
    assert.equal((await resolvePayoutDestination(repUser.id)).accountNumber, accountNumber);

    const blocked = await makePayout({ repId: rep.id, label: "blocked" });
    let blockedProviderCalls = 0;
    const blockedDispatch = await dispatchDuePayouts(undefined, async () => {
      blockedProviderCalls += 1;
      throw new Error("Provider must not be called");
    });
    assert.equal(blockedDispatch.results.find((row) => row.payoutId === blocked.id)?.status, "live_execution_blocked");
    assert.equal(blockedProviderCalls, 0);
    assert.equal((await db.select().from(payouts).where(eq(payouts.id, blocked.id)))[0].state, "queued");
    assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, blocked.id))).length, 0);
    await db.update(payouts).set({ state: "held", lastFailureCode: "acceptance_gate_fixture_complete" }).where(eq(payouts.id, blocked.id));

    const accepted = await makePayout({ repId: rep.id, label: "accepted" });
    const rejected = await makePayout({ repId: rep.id, label: "rejected" });
    const ambiguous = await makePayout({ repId: rep.id, label: "ambiguous" });
    const [product] = await db.select().from(products).orderBy(products.id).limit(1);
    assert.ok(product);
    const customerPhoneHash = createHash("sha256").update(`production-gate-${suffix}`).digest("hex");
    const [attribution] = await db.insert(attributionRecords).values({ repId: rep.id, customerPhoneHash, productId: product.id, vendorId: product.vendorId, source: "link", tokenSig: reference("attribution") }).returning();
    const [deal] = await db.insert(deals).values({
      attributionId: attribution.id,
      productId: product.id,
      vendorId: product.vendorId,
      repId: rep.id,
      customerPhoneHash,
      triggerEvent: "funded",
      eventId: crypto.randomUUID(),
      state: "payable",
      payoutId: ambiguous.id,
      vendorCommissionKobo: 125_000,
      repCommissionKobo: 100_000,
      platformFeeKobo: 25_000,
      confirmAt: new Date(),
    }).returning();
    await db.insert(ledgerEntries).values({ dealId: deal.id, account: "rep_payable", direction: "credit", amountKobo: 100_000, entryGroup: reference("entitlement_credit") });

    const providerInputs: ProviderPayoutInput[] = [];
    const authorized = await dispatchDuePayouts(undefined, async (provider, input) => {
      providerInputs.push({ ...input });
      assert.equal(input.accountNumber, accountNumber);
      if (input.narration.includes(rejected.batchId)) throw new ProviderPayoutError("Explicit sandbox rejection", true);
      if (input.narration.includes(ambiguous.batchId)) throw new ProviderPayoutError("Ambiguous sandbox timeout", false);
      return { provider, providerRef: input.reference, providerStatus: "pending", settlementEligible: false };
    }, async () => true);
    assert.equal(providerInputs.length, 3);
    assert.equal(authorized.results.find((row) => row.payoutId === accepted.id)?.status, "processing");
    assert.equal(authorized.results.find((row) => row.payoutId === accepted.id)?.settlementEligible, false);
    assert.equal(authorized.results.find((row) => row.payoutId === rejected.id)?.status, "queued");
    assert.equal(authorized.results.find((row) => row.payoutId === ambiguous.id)?.status, "held");

    const [acceptedPayout] = await db.select().from(payouts).where(eq(payouts.id, accepted.id));
    const acceptedAttempt = await latestAttempt(accepted.id);
    assert.equal(acceptedPayout.state, "processing");
    assert.equal(acceptedAttempt.state, "initiated");
    assert.ok(acceptedAttempt.providerAcceptedAt);
    assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, accepted.id))).length, 0);
    const [rejectedPayout] = await db.select().from(payouts).where(eq(payouts.id, rejected.id));
    const rejectedAttempt = await latestAttempt(rejected.id);
    assert.equal(rejectedPayout.state, "queued");
    assert.equal(rejectedPayout.lastFailureCode, "provider_request_rejected");
    assert.ok(rejectedPayout.nextRetryAt && rejectedPayout.nextRetryAt > new Date());
    assert.equal(rejectedAttempt.state, "failed");
    const [ambiguousPayout] = await db.select().from(payouts).where(eq(payouts.id, ambiguous.id));
    const ambiguousAttempt = await latestAttempt(ambiguous.id);
    assert.equal(ambiguousPayout.state, "held");
    assert.equal(ambiguousPayout.nextRetryAt, null);
    assert.equal(ambiguousPayout.lastFailureCode, "provider_outcome_unknown");
    assert.equal(ambiguousAttempt.state, "initiated");
    assert.equal(ambiguousAttempt.providerAcceptedAt, null);
    const payoutAudits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "payout"), inArray(auditLogs.entityId, [accepted.id, rejected.id, ambiguous.id].map(String))));
    assert.ok(!JSON.stringify(payoutAudits).includes(accountNumber));

    const repeat = await dispatchDuePayouts(undefined, async () => { throw new Error("No uncertain or accepted payout may auto-retry"); }, async () => true);
    assert.equal(repeat.results.some((row) => [accepted.id, ambiguous.id].includes(Number(row.payoutId))), false);
    assert.equal(providerInputs.length, 3);

    await assert.rejects(() => recordSandboxPayoutOutcome({ payoutId: ambiguous.id, outcome: "success", actorUserId: repUser.id }), /execution mode/);
    await assert.rejects(() => recordVerifiedProviderPayoutOutcome({ payoutId: ambiguous.id, outcome: "success", provider: "paystack", providerRef: ambiguousAttempt.providerRef, providerEventId: reference("wrong_amount"), amountNetKobo: 1 }), /amount/);
    assert.equal((await db.select().from(payouts).where(eq(payouts.id, ambiguous.id)))[0].state, "held");
    const lateSuccess = await recordVerifiedProviderPayoutOutcome({ payoutId: ambiguous.id, outcome: "success", provider: "paystack", providerRef: ambiguousAttempt.providerRef, providerEventId: reference("late_success"), amountNetKobo: 90_000 });
    assert.equal(lateSuccess.status, "paid");
    assert.equal((await db.select().from(deals).where(eq(deals.id, deal.id)))[0].state, "paid");
    assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, ambiguous.id))).length, 3);

    const sandbox = await makePayout({ repId: rep.id, label: "sandbox_mode", mode: "sandbox", state: "processing", attempts: 1 });
    const [sandboxAttempt] = await db.insert(payoutAttempts).values({ payoutId: sandbox.id, attemptNo: 1, provider: "paystack_sandbox", providerRef: reference("sandbox_attempt"), executionMode: "sandbox", state: "initiated" }).returning();
    await assert.rejects(() => recordVerifiedProviderPayoutOutcome({ payoutId: sandbox.id, outcome: "success", provider: "paystack", providerRef: sandboxAttempt.providerRef, providerEventId: reference("mode_confusion"), amountNetKobo: 90_000 }), /execution mode/);
    await recordSandboxPayoutOutcome({ payoutId: sandbox.id, outcome: "failure", actorUserId: repUser.id, failureCode: "sandbox_fixture_complete" });

    const interrupted = await makePayout({ repId: rep.id, label: "interrupted", state: "processing", attempts: 1 });
    const [interruptedAttempt] = await db.insert(payoutAttempts).values({ payoutId: interrupted.id, attemptNo: 1, provider: "paystack", providerRef: reference("interrupted_attempt"), executionMode: "live", state: "initiated" }).returning();
    const stale = new Date(Date.now() - 10 * 60_000);
    await db.update(payouts).set({ updatedAt: stale }).where(eq(payouts.id, interrupted.id));
    await db.update(payouts).set({ updatedAt: stale }).where(eq(payouts.id, accepted.id));
    const recovered = await recoverInterruptedPayoutDispatches();
    assert.equal(recovered.results.find((row) => row.payoutId === interrupted.id)?.status, "held");
    assert.equal((await db.select().from(payouts).where(eq(payouts.id, interrupted.id)))[0].state, "held");
    assert.equal((await latestAttempt(interrupted.id)).id, interruptedAttempt.id);
    assert.equal((await db.select().from(payouts).where(eq(payouts.id, accepted.id)))[0].state, "processing");

    const notificationSecret = "acceptance-notification-signing-secret-32-plus-characters";
    process.env.KF_NOTIFICATION_WEBHOOK_URL = "http://127.0.0.1:65535/signed-notification";
    process.env.KF_NOTIFICATION_WEBHOOK_SECRET = notificationSecret;
    const notificationId = await notifyUser({ userId: repUser.id, type: "acceptance", title: "Signed delivery", body: "Sandbox signed-webhook acceptance", entityType: "acceptance", entityId: suffix });
    const [delivery] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, notificationId)).limit(1);
    assert.ok(delivery);
    const deliveryRequests: Array<{ body: string; headers: Headers }> = [];
    const successfulFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body);
      deliveryRequests.push({ body, headers: new Headers(init?.headers) });
      await new Promise((resolve) => setTimeout(resolve, 75));
      return new Response("sensitive-response-body-not-for-persistence", { status: 200, headers: { "x-receipt-id": "sandbox-receipt" } });
    }) as typeof fetch;
    const concurrentDeliveries = await Promise.all([
      processDueNotificationDeliveries(successfulFetch),
      processDueNotificationDeliveries(successfulFetch),
    ]);
    assert.equal(concurrentDeliveries.reduce((sum, result) => sum + result.delivered, 0), 1);
    assert.equal(deliveryRequests.length, 1);
    const sent = deliveryRequests[0];
    const expectedSignature = createHmac("sha256", notificationSecret).update(`${sent.headers.get("x-kf-timestamp")}.${sent.body}`).digest("hex");
    assert.equal(sent.headers.get("x-kf-signature"), expectedSignature);
    assert.equal(sent.headers.get("x-kf-delivery-id"), String(delivery.id));
    assert.equal(JSON.parse(sent.body).delivery_id, String(delivery.id));
    const [delivered] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, delivery.id)).limit(1);
    assert.equal(delivered.state, "delivered");
    assert.equal(delivered.attempts, 1);
    assert.equal(delivered.receiptHash?.length, 64);
    assert.ok(!JSON.stringify(delivered).includes("sensitive-response-body"));
    assert.equal((await processDueNotificationDeliveries(successfulFetch)).claimed, 0);
    assert.equal(deliveryRequests.length, 1);

    const retryNotificationId = await notifyUser({ userId: repUser.id, type: "acceptance_retry", title: "Retry delivery", body: "Sandbox retry and dead-letter acceptance" });
    const [retryDelivery] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.notificationId, retryNotificationId)).limit(1);
    const failingFetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
    const retry = await processDueNotificationDeliveries(failingFetch);
    assert.equal(retry.retryScheduled, 1);
    const [scheduled] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, retryDelivery.id)).limit(1);
    assert.equal(scheduled.state, "retry_scheduled");
    assert.ok(scheduled.availableAt > new Date());
    await db.update(notificationDeliveries).set({ attempts: 4, availableAt: new Date(Date.now() - 1000) }).where(eq(notificationDeliveries.id, retryDelivery.id));
    const exhausted = await processDueNotificationDeliveries(failingFetch);
    assert.equal(exhausted.deadLetter, 1);
    assert.equal((await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, retryDelivery.id)))[0].state, "dead_letter");

    delete process.env.KF_NOTIFICATION_WEBHOOK_URL;
    delete process.env.KF_NOTIFICATION_WEBHOOK_SECRET;
    assert.equal(integrationConfiguration().effectiveMode, "sandbox");
    const slot = reference("duplicate_job");
    const duplicateJobs = await Promise.all([runDurableJob("auth_session_cleanup", "manual", slot), runDurableJob("auth_session_cleanup", "manual", slot)]);
    assert.equal(duplicateJobs.filter((result) => result.status === "succeeded").length, 1);
    assert.equal(duplicateJobs.filter((result) => result.status === "skipped_duplicate").length, 1);
    const liveHealth = await healthRoutes.request("/live");
    assert.equal(liveHealth.status, 200);
    assert.equal((await liveHealth.json()).mode, "sandbox");
    const readyHealth = await healthRoutes.request("/ready");
    const readyBody = await readyHealth.json();
    assert.equal(readyHealth.status, 200);
    assert.equal(readyBody.status, "ready");
    assert.equal(readyBody.mode, "sandbox");
    assert.equal(readyBody.checks.notificationDeadLettersPresent, true);

    console.log(JSON.stringify({
      status: "passed",
      mode: "isolated_sandbox_database_and_injected_provider_responses_only",
      liveProviderRequests: 0,
      realBankTransfers: 0,
      productionReady: false,
      encryptedDestination: { authenticatedEncryption: true, randomIv: true, tamperRejected: true, wrongKeyRejected: true, plaintextExcludedFromStatusAuditAndRows: true },
      liveDispatch: { unapprovedExecutionBlocked: true, acceptanceRemainsUnsettled: true, explicitRejectionRetries: true, ambiguousOutcomeHeld: true, automaticUnknownRetryBlocked: true, lateVerifiedOutcomeReconciled: true, acceptedAttemptNotRecoveredAsUnknown: true },
      modeIsolation: { sandboxOutcomeRejectedForLiveAttempt: true, verifiedLiveOutcomeRejectedForSandboxAttempt: true },
      notificationDelivery: { validHmac: true, stableDeliveryId: true, concurrentRequests: deliveryRequests.length, deliveredReplaySuppressed: true, retryScheduled: true, deadLetter: true, responseBodyPersisted: false, externalChannelReadReceipt: false },
      operations: { duplicateJobClaimsSuppressed: true, truthfulSandboxHealth: true, readinessWithDeadLetterAlert: readyBody.status },
      references: { acceptedPayoutId: accepted.id, rejectedPayoutId: rejected.id, reconciledPayoutId: ambiguous.id, interruptedPayoutId: interrupted.id, deliveredNotificationId: notificationId, deadLetterNotificationId: retryNotificationId },
    }, null, 2));
  } finally {
    for (const payout of isolatedQueuedPayouts) {
      await db.update(payouts).set({ nextRetryAt: payout.nextRetryAt }).where(and(eq(payouts.id, payout.id), eq(payouts.state, "queued")));
    }
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
