import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  auditLogs,
  campuses,
  deals,
  launchGateEvents,
  ledgerEntries,
  payoutAttempts,
  payouts,
  providerWebhookEvents,
  reps,
  users,
} from "../db/schema";
import {
  approveLaunchGate,
  assertLiveProviderExecutionAuthorized,
  ensureLaunchGateCatalog,
  getLaunchReadiness,
  submitLaunchGateEvidence,
} from "../api/services/launchReadiness";
import { initiateLiveProviderPayout } from "../api/services/payoutProviders";
import { processProviderWebhook } from "../api/services/providerWebhooks";
import { completeSyntheticIdentityWorkflow } from "../api/services/identityFixtures";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const phone = () => `+23492${String(randomInt(10000000, 99999999))}`;
const reference = (label: string) => `${label}_${suffix}`.slice(0, 50);

async function main() {
  const originalEnv = {
    KF_PROVIDER_MODE: process.env.KF_PROVIDER_MODE,
    KF_LIVE_CUTOVER_AUTHORIZED: process.env.KF_LIVE_CUTOVER_AUTHORIZED,
    KF_APP_URL: process.env.KF_APP_URL,
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
    KF_SANDBOX_MODE: process.env.KF_SANDBOX_MODE,
    KF_PAYOUT_ENCRYPTION_KEY: process.env.KF_PAYOUT_ENCRYPTION_KEY,
  };
  try {
    process.env.KF_PROVIDER_MODE = "sandbox";
    delete process.env.KF_LIVE_CUTOVER_AUTHORIZED;
    delete process.env.KF_APP_URL;
    await ensureLaunchGateCatalog();
    const readiness = await getLaunchReadiness();
    assert.equal(readiness.gates.length, 25);
    assert.equal(readiness.summary.required, 24);
    assert.equal(readiness.summary.productionReady, false);
    assert.equal(readiness.configuration.effectiveMode, "sandbox");
    assert.ok(!("PAYSTACK_SECRET_KEY" in readiness.configuration));
    await assert.rejects(() => assertLiveProviderExecutionAuthorized(), /disabled/);
    await assert.rejects(() => initiateLiveProviderPayout("paystack", {
      accountName: "Never Called",
      accountNumber: "0123456789",
      bankCode: "058",
      amountNetKobo: 90_000,
      reference: reference("never_called"),
      narration: "Guard test; no request may occur",
    }), /disabled/);

    const [submitter, reviewer, repUser] = await db.insert(users).values([
      { phoneE164: phone(), name: "Phase Ten Evidence Submitter", role: "ops" },
      { phoneE164: phone(), name: "Phase Ten Independent Reviewer", role: "finance" },
      { phoneE164: phone(), name: "Phase Ten Webhook Rep", role: "rep", kycState: "verified", bankNameMatch: true },
    ]).returning();
    const evidenceGate = readiness.gates.find((gate) => ["not_started", "rejected"].includes(gate.state))!;
    assert.ok(evidenceGate, "A fresh launch gate is required for this append-only acceptance fixture");
    const evidenceReference = `local-evidence-${suffix.slice(0, 12)}`;
    const submitted = await submitLaunchGateEvidence({
      gateId: evidenceGate.id,
      actorUserId: submitter.id,
      evidenceReference,
      note: "Local measurement reference submitted without credentials or production claims.",
    });
    assert.equal(submitted.independentApprovalRequired, true);
    await assert.rejects(() => approveLaunchGate({
      gateId: evidenceGate.id,
      actorUserId: submitter.id,
      approvalReference: "self-approval-not-allowed",
      note: "This self review must be rejected by the four-eyes launch policy.",
    }), /Independent review/);
    const approved = await approveLaunchGate({
      gateId: evidenceGate.id,
      actorUserId: reviewer.id,
      approvalReference: `independent-review-${suffix.slice(0, 12)}`,
      note: "Independent attestation recorded; the external system itself is not certified.",
    });
    assert.equal(approved.externalSystemVerified, false);
    await assert.rejects(() => approveLaunchGate({
      gateId: evidenceGate.id,
      actorUserId: reviewer.id,
      approvalReference: "duplicate-review",
      note: "A second decision cannot overwrite the append-only approval history.",
    }), /Only submitted evidence/);
    const history = await db.select().from(launchGateEvents).where(eq(launchGateEvents.gateId, evidenceGate.id)).orderBy(launchGateEvents.id);
    assert.deepEqual(history.slice(-2).map((event) => event.action), ["evidence_submitted", "external_approval_attested"]);
    const secretGate = readiness.gates.find((gate) => gate.required && gate.state === "not_started")!;
    await assert.rejects(() => submitLaunchGateEvidence({
      gateId: secretGate.id,
      actorUserId: submitter.id,
      evidenceReference: "api_key=must-not-be-accepted",
      note: "Credential-shaped evidence must be rejected before persistence.",
    }), /must not contain credentials/);

    process.env.KF_PROVIDER_MODE = "live";
    process.env.KF_LIVE_CUTOVER_AUTHORIZED = "true";
    process.env.KF_SANDBOX_MODE = "false";
    process.env.KF_PAYOUT_ENCRYPTION_KEY = "11".repeat(32);
    process.env.PAYSTACK_SECRET_KEY = "phase10-sandbox-configuration-fixture";
    process.env.KF_APP_URL = "https://example.invalid";
    await assert.rejects(() => assertLiveProviderExecutionAuthorized(), /every required launch gate/);
    process.env.KF_PROVIDER_MODE = "sandbox";
    delete process.env.KF_LIVE_CUTOVER_AUTHORIZED;
    delete process.env.KF_APP_URL;

    const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
    const [rep] = await db.insert(reps).values({ userId: repUser.id, campusId: campus.id, code: `P10-${suffix.slice(0, 8)}`, status: "active" }).returning();
    await completeSyntheticIdentityWorkflow({
      caseType: "representative_kyc",
      subjectType: "user",
      subjectId: repUser.id,
      requestUserId: repUser.id,
      reviewerUserId: submitter.id,
      campusId: campus.id,
    });
    const successRef = reference("provider_success");
    const [payout] = await db.insert(payouts).values({
      repId: rep.id,
      amountGrossKobo: 100_000,
      amountNetKobo: 90_000,
      withholdingKobo: 10_000,
      provider: "paystack",
      providerRef: reference("payout_record"),
      executionMode: "live",
      state: "processing",
      batchId: `P10-${suffix.slice(0, 12)}`,
      attempts: 1,
    }).returning();
    const [attempt] = await db.insert(payoutAttempts).values({ payoutId: payout.id, attemptNo: 1, provider: "paystack", providerRef: successRef, executionMode: "live", state: "initiated" }).returning();
    // A payable entitlement and its existing credit are the minimum valid ledger
    // fixture. No real vendor, provider or bank transaction is represented here.
    const [vendorUser] = await db.insert(users).values({ phoneE164: phone(), name: "Phase Ten Fixture Vendor", role: "vendor" }).returning();
    const { vendors, products, attributionRecords } = await import("../db/schema");
    const [vendor] = await db.insert(vendors).values({ userId: vendorUser.id, companyName: "Phase Ten Fixture Vendor", webhookKey: `p10_${suffix}`, webhookSecret: "not-a-live-credential", status: "active" }).returning();
    const [product] = await db.insert(products).values({ vendorId: vendor.id, vendorRef: `p10-${suffix}`, name: "Phase Ten Settlement Fixture", category: "fintech", description: "Database-only provider outcome test", priceKobo: 100_000, landingUrl: "https://example.invalid", pitchScript: "Test fixture", status: "active" }).returning();
    const [attribution] = await db.insert(attributionRecords).values({ repId: rep.id, customerPhoneHash: suffix.padEnd(64, "a").slice(0, 64), productId: product.id, vendorId: vendor.id, source: "link", tokenSig: suffix }).returning();
    const [deal] = await db.insert(deals).values({ attributionId: attribution.id, productId: product.id, vendorId: vendor.id, repId: rep.id, customerPhoneHash: attribution.customerPhoneHash, triggerEvent: "funded", eventId: crypto.randomUUID(), state: "payable", payoutId: payout.id, vendorCommissionKobo: 125_000, repCommissionKobo: 100_000, platformFeeKobo: 25_000, confirmAt: new Date() }).returning();
    await db.insert(ledgerEntries).values({ dealId: deal.id, account: "rep_payable", direction: "credit", amountKobo: 100_000, entryGroup: reference("fixture_credit") });

    const payload = {
      event: "transfer.success",
      data: { id: 987654, reference: successRef, amount: 90_000, status: "success", account_number: "0123456789" },
    };
    const secret = "phase10-test-signature-secret";
    process.env.PAYSTACK_SECRET_KEY = secret;
    const raw = JSON.stringify(payload);
    const sign = (body: string) => createHmac("sha512", secret).update(body).digest("hex");
    await assert.rejects(() => processProviderWebhook({ provider: "paystack", rawBody: raw, signature: "invalid" }), /signature/);
    const mismatchRaw = JSON.stringify({ ...payload, data: { ...payload.data, amount: 1 } });
    const mismatch = await processProviderWebhook({ provider: "paystack", rawBody: mismatchRaw, signature: sign(mismatchRaw) });
    assert.equal(mismatch.status, "quarantined");
    const [stillProcessing] = await db.select().from(payouts).where(eq(payouts.id, payout.id));
    assert.equal(stillProcessing.state, "processing");
    assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, payout.id))).length, 0);

    const completed = await processProviderWebhook({ provider: "paystack", rawBody: raw, signature: sign(raw) });
    assert.deepEqual(completed, { status: "processed", payoutId: payout.id, outcome: "paid" });
    const duplicate = await processProviderWebhook({ provider: "paystack", rawBody: raw, signature: sign(raw) });
    assert.equal(duplicate.status, "duplicate");
    const [paid] = await db.select().from(payouts).where(eq(payouts.id, payout.id));
    const [paidAttempt] = await db.select().from(payoutAttempts).where(eq(payoutAttempts.id, attempt.id));
    const [paidDeal] = await db.select().from(deals).where(eq(deals.id, deal.id));
    const settlementEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, payout.id));
    assert.equal(paid.state, "paid");
    assert.equal(paidAttempt.state, "succeeded");
    assert.equal(paidDeal.state, "paid");
    assert.equal(settlementEntries.length, 3);
    assert.equal(settlementEntries.filter((entry) => entry.account === "external_bank").length, 1);
    const storedEvents = await db.select().from(providerWebhookEvents).where(eq(providerWebhookEvents.payoutId, payout.id));
    assert.ok(storedEvents.length >= 2);
    assert.ok(!JSON.stringify(storedEvents).includes("0123456789"));
    const reversalRaw = JSON.stringify({ event: "transfer.reversed", data: { reference: successRef, amount: 90_000, status: "reversed" } });
    const reversal = await processProviderWebhook({ provider: "paystack", rawBody: reversalRaw, signature: sign(reversalRaw) });
    assert.equal(reversal.status, "quarantined");
    assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, payout.id))).length, 3);
    const outcomeAudits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "payout"), eq(auditLogs.entityId, String(payout.id)), eq(auditLogs.action, "provider_webhook.verified_outcome")));
    assert.equal(outcomeAudits.length, 1);
    assert.ok(!JSON.stringify(outcomeAudits).includes("0123456789"));

    console.log(JSON.stringify({
      status: "passed",
      mode: "sandbox_database_and_signed_test_payloads_only",
      launch: { catalog: 25, required: 24, independentApproval: true, selfApprovalBlocked: true, credentialTextBlocked: true, productionReady: false },
      providerGuard: { sandboxBlocked: true, incompleteLiveApprovalsBlocked: true, liveRequestMade: false },
      webhook: { badSignatureRejected: true, amountMismatchQuarantined: true, exactOutcomeProcessed: true, duplicateSettlements: 0, reversalQuarantined: true, rawBankValuesPersisted: false },
      references: { launchGateId: evidenceGate.id, payoutId: payout.id, providerEventCount: storedEvents.length },
    }, null, 2));
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
