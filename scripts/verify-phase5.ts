import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import app from "../api/boot";
import { getDb } from "../api/queries/connection";
import {
  auditLogs,
  campusLeadAssignments,
  campusLeadOverrides,
  campusRecruitments,
  campuses,
  deals,
  escrowWallets,
  jobRuns,
  ledgerEntries,
  notifications,
  products,
  rateLimitBuckets,
  reps,
  users,
  vendors,
} from "../db/schema";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent } from "../api/services/events";
import { runDurableJob } from "../api/services/jobs";
import { recalculateCampusLeadEligibility } from "../api/services/leadEligibility";
import { confirmDueDeals } from "../api/services/ledger";
import {
  consumeRateLimit,
  rateLimitSubjectHash,
  rateLimitWindowStart,
} from "../api/services/rateLimit";

const db = getDb();
const uniquePhone = () => `+2348${String(randomInt(1_000_000_000)).padStart(9, "0")}`;
const uniqueCode = () => `KF-P5-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

async function createCampus(label: string) {
  const [campus] = await db.insert(campuses).values({
    name: `Phase Five ${label} ${crypto.randomUUID().slice(0, 8)}`,
    state: "Sandbox",
    status: "launching",
  }).returning();
  return campus;
}

async function createRep(input: {
  campusId: number;
  label: string;
  tier?: "starter" | "bronze" | "silver" | "gold" | "campus_lead";
  leadPreviousTier?: "starter" | "bronze" | "silver" | "gold";
}) {
  const [user] = await db.insert(users).values({
    phoneE164: uniquePhone(),
    name: input.label,
    role: "rep",
    kycState: "verified",
    ninToken: `sandbox_identity_${crypto.randomUUID()}`,
    bankName: "Sandbox Bank",
    bankCode: "999",
    bankAccountLast4: "0000",
    bankAccountName: input.label,
    bankNameMatch: true,
  }).returning();
  const [rep] = await db.insert(reps).values({
    userId: user.id,
    campusId: input.campusId,
    code: uniqueCode(),
    tier: input.tier || "starter",
    leadPreviousTier: input.leadPreviousTier,
    status: "active",
    contractorAgreementSignedAt: new Date(),
  }).returning();
  return { rep, user };
}

async function makeConfirmedDeal(repId: number) {
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  assert.ok(product);
  const phone = uniquePhone();
  await ensureAttribution({ repId, productId: product.id, customerPhone: phone, source: "link" });
  const result = await ingestVendorEvent("campussave_sandbox", {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone, customer_ref: `phase5-${crypto.randomUUID()}` },
    product_ref: "savings-01",
    amount_kobo: 500_000,
    meta: { verification: "phase5_acceptance" },
  });
  assert.equal(result.status, "accepted");
  assert.ok("deal_id" in result && result.deal_id);
  await db.update(deals).set({ confirmAt: new Date(Date.now() - 1000) }).where(eq(deals.id, result.deal_id!));
  await confirmDueDeals();
  const [deal] = await db.select().from(deals).where(eq(deals.id, result.deal_id!)).limit(1);
  assert.equal(deal.state, "payable");
  return deal;
}

async function verifyHealth() {
  const liveResponse = await app.request("/api/health/live");
  assert.equal(liveResponse.status, 200);
  const live = await liveResponse.json();
  assert.equal(live.status, "ok");
  assert.equal(live.mode, "sandbox");

  const readyResponse = await app.request("/api/health/ready");
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.equal(ready.status, "ready");
  assert.equal(ready.checks.database, "up");
  assert.equal(ready.checks.worker, "fresh");
  assert.equal(ready.checks.providerConfiguration, "valid");
  assert.ok(ready.checks.latestSuccessfulJobAt);
  return { liveness: live.status, readiness: ready.status, database: ready.checks.database, worker: ready.checks.worker };
}

async function verifyRateLimits() {
  const subject = `198.51.100.${randomInt(1, 250)}`;
  const now = new Date();
  const windowStartedAt = rateLimitWindowStart(now, 600);
  const concurrent = await Promise.all(Array.from({ length: 32 }, () => consumeRateLimit({
    policy: "otp_verify",
    subject,
    limit: 24,
    windowSeconds: 600,
    now,
  })));
  const counts = concurrent.map((result) => result.requestCount).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 32 }, (_, index) => index + 1));
  assert.equal(concurrent.filter((result) => result.allowed).length, 24);
  assert.equal(concurrent.filter((result) => !result.allowed).length, 8);
  const keyHash = rateLimitSubjectHash("otp_verify", subject, windowStartedAt);
  const [bucket] = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.keyHash, keyHash)).limit(1);
  assert.equal(bucket.requestCount, 32);
  assert.equal(bucket.keyHash.length, 64);
  assert.ok(!bucket.keyHash.includes(subject));

  const routeSubject = `203.0.113.${randomInt(1, 250)}`;
  const routeWindow = rateLimitWindowStart(new Date(), 600);
  const responses = [];
  for (let index = 0; index < 6; index += 1) {
    responses.push(await app.request("/api/trpc/auth.requestOtp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": routeSubject },
      body: JSON.stringify({ json: { phone: uniquePhone() } }),
    }));
  }
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200, 429]);
  const retryAfter = Number(responses[5].headers.get("retry-after"));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 600);
  const throttledBody = await responses[5].json();
  assert.equal(throttledBody.error, "Rate limit exceeded");
  const routeHash = rateLimitSubjectHash("otp_request", routeSubject, routeWindow);
  const [routeBucket] = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.keyHash, routeHash)).limit(1);
  assert.equal(routeBucket.requestCount, 6);
  assert.ok(!routeBucket.keyHash.includes(routeSubject));

  const expiredHash = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const [expired] = await db.insert(rateLimitBuckets).values({
    keyHash: expiredHash,
    policy: "otp_request",
    windowStartedAt: new Date(Date.now() - 7200_000),
    requestCount: 1,
    expiresAt: new Date(Date.now() - 3600_000),
    updatedAt: new Date(Date.now() - 3600_000),
  }).returning();
  const cleanup = await runDurableJob("rate_limit_cleanup", "manual", `phase5-cleanup-${crypto.randomUUID()}`);
  assert.equal(cleanup.status, "succeeded");
  const [expiredAfter] = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.id, expired.id)).limit(1);
  const [liveAfter] = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.keyHash, keyHash)).limit(1);
  assert.equal(expiredAfter, undefined);
  assert.ok(liveAfter);
  return {
    concurrentRequests: 32,
    atomicCounterSequence: true,
    allowed: 24,
    throttled: 8,
    sensitiveRouteStatus: 429,
    retryAfterSeconds: retryAfter,
    rawSubjectsPersisted: false,
    expiredBucketsRemoved: true,
    liveBucketsRetained: true,
  };
}

async function verifyLeadEligibility() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  assert.ok(ops && vendor);
  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  if (wallet.balanceKobo < 10_000_000) {
    await db.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + 30_000_000 }).where(eq(escrowWallets.vendorId, vendor.id));
  }

  const retainedCampus = await createCampus("Retained Lead Campus");
  const retained = await createRep({
    campusId: retainedCampus.id,
    label: "Phase Five Retained Lead",
    tier: "campus_lead",
    leadPreviousTier: "silver",
  });

  const demotionCampus = await createCampus("Demotion Campus");
  const demoted = await createRep({
    campusId: demotionCampus.id,
    label: "Phase Five Demoted Lead",
    tier: "campus_lead",
    leadPreviousTier: "gold",
  });
  const sourceA = await createRep({ campusId: demotionCampus.id, label: "Phase Five Source A", tier: "silver" });
  const sourceB = await createRep({ campusId: demotionCampus.id, label: "Phase Five Source B", tier: "bronze" });
  for (let index = 0; index < 8; index += 1) {
    await createRep({ campusId: demotionCampus.id, label: `Phase Five Ranking Rep ${index + 1}` });
  }
  const [assignment] = await db.insert(campusLeadAssignments).values({
    leadRepId: demoted.rep.id,
    repId: sourceA.rep.id,
    campusId: demotionCampus.id,
    assignedByUserId: ops.id,
  }).returning();
  const [invitation] = await db.insert(campusRecruitments).values({
    leadRepId: demoted.rep.id,
    campusId: demotionCampus.id,
    name: "Phase Five Open Invitation",
    phoneE164: uniquePhone(),
    tokenHash: crypto.randomUUID().replaceAll("-", "").repeat(2),
    expiresAt: new Date(Date.now() + 86_400_000),
  }).returning();

  const overrideDeal = await makeConfirmedDeal(sourceA.rep.id);
  await makeConfirmedDeal(sourceB.rep.id);
  const [historicalOverride] = await db.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.dealId, overrideDeal.id)).limit(1);
  assert.ok(historicalOverride);
  assert.equal(historicalOverride.leadRepId, demoted.rep.id);
  assert.equal(historicalOverride.state, "accrued");
  const historicalLedger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, overrideDeal.id));
  assert.equal(historicalLedger.length, 5);

  const recalculated = await recalculateCampusLeadEligibility(ops.id);
  assert.equal(recalculated.results.find((row) => row.repId === demoted.rep.id)?.status, "demoted");
  assert.equal(recalculated.results.find((row) => row.repId === retained.rep.id)?.status, "retained");

  const [demotedAfter] = await db.select().from(reps).where(eq(reps.id, demoted.rep.id)).limit(1);
  const [retainedAfter] = await db.select().from(reps).where(eq(reps.id, retained.rep.id)).limit(1);
  assert.equal(demotedAfter.tier, "gold");
  assert.equal(demotedAfter.leadPreviousTier, null);
  assert.ok(demotedAfter.leadDemotedAt);
  assert.ok(demotedAfter.leadDemotionReason?.includes("outside_campus_top_decile"));
  assert.equal(retainedAfter.tier, "campus_lead");
  assert.ok(retainedAfter.leadEligibilitySyncedAt);

  const [assignmentAfter] = await db.select().from(campusLeadAssignments).where(eq(campusLeadAssignments.id, assignment.id)).limit(1);
  const [invitationAfter] = await db.select().from(campusRecruitments).where(eq(campusRecruitments.id, invitation.id)).limit(1);
  assert.ok(assignmentAfter.revokedAt);
  assert.equal(invitationAfter.status, "revoked");
  assert.equal(invitationAfter.revokedByUserId, ops.id);
  const activeAssignments = await db.select().from(campusLeadAssignments).where(and(
    eq(campusLeadAssignments.leadRepId, demoted.rep.id),
    isNull(campusLeadAssignments.revokedAt),
  ));
  assert.equal(activeAssignments.length, 0);

  const [notification] = await db.select().from(notifications).where(and(
    eq(notifications.userId, demoted.user.id),
    eq(notifications.type, "campus_lead_eligibility"),
  )).orderBy(desc(notifications.id)).limit(1);
  assert.ok(notification);
  assert.ok(notification.body.includes("Historical overrides are preserved"));
  const [demotionAudit] = await db.select().from(auditLogs).where(and(
    eq(auditLogs.action, "campus_lead.demoted"),
    eq(auditLogs.entityId, String(demoted.rep.id)),
  )).orderBy(desc(auditLogs.id)).limit(1);
  assert.ok(demotionAudit);

  const [overrideAfter] = await db.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.id, historicalOverride.id)).limit(1);
  assert.equal(overrideAfter.state, historicalOverride.state);
  assert.equal(overrideAfter.overrideKobo, historicalOverride.overrideKobo);
  assert.equal(overrideAfter.payoutId, historicalOverride.payoutId);
  assert.equal(overrideAfter.reversedAt, historicalOverride.reversedAt);
  const ledgerAfter = await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, overrideDeal.id));
  assert.equal(ledgerAfter.length, historicalLedger.length);

  await makeConfirmedDeal(sourceA.rep.id);
  const overridesAfterNewDeal = await db.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.leadRepId, demoted.rep.id));
  assert.equal(overridesAfterNewDeal.length, 1);

  const slot = `phase5-lead-hour-${crypto.randomUUID()}`;
  const jobResults = await Promise.all([
    runDurableJob("lead_eligibility", "schedule", slot),
    runDurableJob("lead_eligibility", "schedule", slot),
  ]);
  assert.deepEqual(jobResults.map((result) => result.status).sort(), ["skipped_duplicate", "succeeded"]);
  const slotRuns = await db.select().from(jobRuns).where(and(eq(jobRuns.jobKey, "lead_eligibility"), eq(jobRuns.slotKey, slot)));
  assert.equal(slotRuns.length, 1);

  return {
    eligibleLeadRetained: true,
    ineligibleLeadDemoted: true,
    restoredTier: demotedAfter.tier,
    activeAssignmentsRevoked: true,
    openInvitationsRevoked: true,
    notificationRecorded: true,
    auditRecorded: true,
    historicalOverridesPreserved: true,
    historicalLedgerEntriesPreserved: true,
    futureOverrideAccrualDisabled: true,
    hourlySlotDeduplicated: true,
  };
}

async function main() {
  const health = await verifyHealth();
  const rateLimits = await verifyRateLimits();
  const leadEligibility = await verifyLeadEligibility();
  console.log(JSON.stringify({ status: "passed", mode: "sandbox", health, rateLimits, leadEligibility }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
