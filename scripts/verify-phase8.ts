import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  activationVelocityBuckets,
  auditLogs,
  campuses,
  commissionRules,
  deals,
  fraudCaseEvents,
  fraudCases,
  fraudHolds,
  ledgerEntries,
  operationalIncidents,
  payoutAttempts,
  payouts,
  products,
  reps,
  users,
  vendorEvents,
  vendors,
} from "../db/schema";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent, type VendorEventInput } from "../api/services/events";
import {
  blockingFraudHold,
  createOperationsFraudCase,
  requestFraudAppeal,
  reviewFraudCase,
} from "../api/services/fraud";
import { dispatchDuePayouts, runPayoutBatch } from "../api/services/ledger";
import { monitorOperationalSignals } from "../api/services/incidents";

const db = getDb();
const suffix = crypto.randomUUID();
const phone = () => `+23490${String(randomInt(10000000, 99999999))}`;

function event(productRef: string, customerPhone: string, id: string): VendorEventInput {
  return {
    event_id: id,
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: customerPhone, customer_ref: `phase8-${id}` },
    product_ref: productRef,
    amount_kobo: 500_000,
    meta: { channel: "phase8_acceptance" },
  };
}

async function financialSnapshot(repId: number) {
  const dealRows = await db.select().from(deals).where(eq(deals.repId, repId)).orderBy(deals.id);
  const dealIds = dealRows.map((deal) => deal.id);
  const ledgerRows = dealIds.length ? await db.select().from(ledgerEntries).where(inArray(ledgerEntries.dealId, dealIds)).orderBy(ledgerEntries.id) : [];
  return JSON.stringify({ dealRows, ledgerRows });
}

async function main() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
  assert.ok(ops && vendor && product && campus);

  const customerPhone = phone();
  const [user] = await db.insert(users).values({
    phoneE164: phone(),
    name: "Phase Eight Velocity Rep",
    role: "rep",
    kycState: "verified",
    bankName: "Sandbox Bank",
    bankCode: "999",
    bankAccountLast4: "0008",
    bankAccountName: "Phase Eight Velocity Rep",
    bankNameMatch: true,
  }).returning();
  const [rep] = await db.insert(reps).values({ userId: user.id, campusId: campus.id, code: `P8-${suffix.slice(0, 8)}`, status: "active" }).returning();
  const { attribution } = await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone, source: "link", actorUserId: user.id });
  assert.ok(attribution);

  const accepted = [];
  for (let index = 1; index <= 10; index += 1) {
    accepted.push(await ingestVendorEvent(vendor.webhookKey, event(product.vendorRef, customerPhone, `${suffix}-${index}`)));
  }
  assert.ok(accepted.every((result) => result.status === "accepted"));
  const eleventh = await ingestVendorEvent(vendor.webhookKey, event(product.vendorRef, customerPhone, `${suffix}-11`));
  assert.equal(eleventh.status, "quarantined");
  assert.equal(eleventh.reason, "Daily activation cap exceeded; payout hold opened for Operations review");
  const eleventhCaseRef = "fraud_case_ref" in eleventh ? eleventh.fraud_case_ref : null;
  assert.ok(eleventhCaseRef);
  const twelfth = await ingestVendorEvent(vendor.webhookKey, event(product.vendorRef, customerPhone, `${suffix}-12`));
  assert.equal(twelfth.status, "quarantined");
  assert.equal("fraud_case_ref" in twelfth ? twelfth.fraud_case_ref : null, eleventhCaseRef);
  const duplicate = await ingestVendorEvent(vendor.webhookKey, event(product.vendorRef, customerPhone, `${suffix}-12`));
  assert.equal(duplicate.status, "duplicate");

  const [velocityBucket] = await db.select().from(activationVelocityBuckets).where(eq(activationVelocityBuckets.repId, rep.id));
  assert.equal(velocityBucket.attemptCount, 12);
  assert.equal(velocityBucket.cap, 10);
  const [capCase] = await db.select().from(fraudCases).where(eq(fraudCases.caseRef, eleventhCaseRef)).limit(1);
  const [capHold] = await db.select().from(fraudHolds).where(eq(fraudHolds.caseId, capCase.id)).limit(1);
  assert.equal(capCase.reason, "activation_velocity");
  assert.equal(capCase.state, "open");
  assert.equal(capHold.state, "active");
  assert.equal(capCase.reviewDueAt.getTime() - capCase.createdAt.getTime(), 24 * 60 * 60 * 1000);
  const fraudText = JSON.stringify(capCase);
  assert.ok(!fraudText.includes(customerPhone));
  assert.ok(!fraudText.includes(attribution.customerPhoneHash));
  const capEvents = await db.select().from(vendorEvents).where(inArray(vendorEvents.dedupeKey, [`${vendor.id}:${suffix}-11`, `${vendor.id}:${suffix}-12`]));
  assert.ok(capEvents.every((vendorEvent) => vendorEvent.status === "quarantined"));
  assert.ok(capEvents.every((vendorEvent) => !JSON.stringify(vendorEvent.payloadJson).includes(customerPhone)));

  const [payableDeal] = await db.insert(deals).values({
    attributionId: attribution.id,
    productId: product.id,
    vendorId: vendor.id,
    repId: rep.id,
    customerPhoneHash: attribution.customerPhoneHash,
    triggerEvent: "funded",
    eventId: crypto.randomUUID(),
    state: "payable",
    vendorCommissionKobo: 100_000,
    repCommissionKobo: 80_000,
    platformFeeKobo: 20_000,
    confirmAt: new Date(),
  }).returning();
  await db.insert(ledgerEntries).values({ dealId: payableDeal.id, account: "rep_payable", direction: "credit", amountKobo: 80_000, entryGroup: `phase8-${suffix}` });
  const heldBatch = await runPayoutBatch(ops.id);
  assert.equal(heldBatch.results.find((result) => result.repId === rep.id)?.status, "held");
  assert.match(heldBatch.results.find((result) => result.repId === rep.id)?.reason || "", /Fraud case/);
  assert.equal((await db.select().from(payouts).where(eq(payouts.repId, rep.id))).length, 0);

  const releasedCap = await reviewFraudCase({ caseId: capCase.id, actorUserId: ops.id, decision: "release", conductAction: "strike", note: "Velocity evidence reviewed; release this hold without changing financial records." });
  assert.equal(releasedCap.state, "released");
  assert.equal(releasedCap.financialReversalApplied, false);
  const thirteenth = await ingestVendorEvent(vendor.webhookKey, event(product.vendorRef, customerPhone, `${suffix}-13`));
  assert.equal(thirteenth.status, "quarantined");
  const secondCaseRef = "fraud_case_ref" in thirteenth ? thirteenth.fraud_case_ref : null;
  assert.ok(secondCaseRef && secondCaseRef !== eleventhCaseRef);
  const [secondCapCase] = await db.select().from(fraudCases).where(eq(fraudCases.caseRef, secondCaseRef)).limit(1);
  await reviewFraudCase({ caseId: secondCapCase.id, actorUserId: ops.id, decision: "release", conductAction: "strike", note: "Second post-release cap breach reviewed and released independently." });

  const queuedBatch = await runPayoutBatch(ops.id);
  const queuedResult = queuedBatch.results.find((result) => result.repId === rep.id);
  assert.equal(queuedResult?.status, "queued");
  assert.ok(queuedResult?.payoutId);

  const concurrentPhone = phone();
  const [concurrentUser] = await db.insert(users).values({ phoneE164: phone(), name: "Phase Eight Concurrent Rep", role: "rep", kycState: "verified", bankNameMatch: true }).returning();
  const [concurrentRep] = await db.insert(reps).values({ userId: concurrentUser.id, campusId: campus.id, code: `P8C-${suffix.slice(0, 8)}`, status: "active" }).returning();
  const [capOneProduct] = await db.insert(products).values({
    vendorId: vendor.id,
    vendorRef: `phase8-cap-one-${suffix.slice(0, 8)}`,
    name: "Phase Eight Cap One Product",
    category: "fintech",
    description: "Sandbox concurrency fixture",
    priceKobo: 500_000,
    landingUrl: "https://example.invalid/phase8",
    pitchScript: "Sandbox only",
    status: "active",
  }).returning();
  await db.insert(commissionRules).values({ productId: capOneProduct.id, version: 1, basis: "flat", flatAmountKobo: 100_000, triggerEvent: "funded", confirmDays: 30, clawbackDays: 60, activationCapPerRepDay: 1 });
  await ensureAttribution({ repId: concurrentRep.id, productId: capOneProduct.id, customerPhone: concurrentPhone, source: "link", actorUserId: concurrentUser.id });
  const concurrent = await Promise.all([
    ingestVendorEvent(vendor.webhookKey, event(capOneProduct.vendorRef, concurrentPhone, `${suffix}-concurrent-a`)),
    ingestVendorEvent(vendor.webhookKey, event(capOneProduct.vendorRef, concurrentPhone, `${suffix}-concurrent-b`)),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), ["accepted", "quarantined"]);
  const concurrentCases = await db.select().from(fraudCases).where(eq(fraudCases.repId, concurrentRep.id));
  assert.equal(concurrentCases.length, 1);
  const [concurrentBucket] = await db.select().from(activationVelocityBuckets).where(eq(activationVelocityBuckets.repId, concurrentRep.id));
  assert.equal(concurrentBucket.attemptCount, 2);

  const manualA = await createOperationsFraudCase({ repId: rep.id, actorUserId: ops.id, note: "Manual evidence review A creates an independent payout hold." });
  const manualB = await createOperationsFraudCase({ repId: rep.id, actorUserId: ops.id, note: "Manual evidence review B creates a second independent payout hold." });
  await reviewFraudCase({ caseId: manualA.caseId, actorUserId: ops.id, decision: "release", conductAction: "strike", note: "Release only case A; case B must continue to block payouts." });
  const remainingHold = await db.transaction(async (tx) => blockingFraudHold(tx, rep.id));
  assert.equal(remainingHold?.fraudCase.id, manualB.caseId);
  const blockedDispatch = await dispatchDuePayouts(ops.id);
  assert.equal(blockedDispatch.results.find((result) => result.payoutId === queuedResult.payoutId)?.status, "fraud_hold");
  assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, queuedResult.payoutId!))).length, 0);

  const beforeConduct = await financialSnapshot(rep.id);
  const upheld = await reviewFraudCase({ caseId: manualB.caseId, actorUserId: ops.id, decision: "uphold", conductAction: "suspension", note: "Case B upheld after evidence review; controlled clawback review is required separately." });
  assert.equal(upheld.state, "upheld");
  assert.equal(upheld.conductAction, "suspension");
  assert.equal(upheld.clawbackRequired, true);
  assert.equal(upheld.financialReversalApplied, false);
  const [suspendedRep] = await db.select().from(reps).where(eq(reps.id, rep.id)).limit(1);
  assert.equal(suspendedRep.status, "suspended");
  assert.equal(await financialSnapshot(rep.id), beforeConduct);

  const appeal = await requestFraudAppeal({ caseId: manualB.caseId, repId: rep.id, actorUserId: user.id, note: "Representative appeal supplies additional evidence for Operations review." });
  assert.equal(appeal.state, "appeal_open");
  assert.ok(Math.abs(appeal.reviewDueAt.getTime() - Date.now() - 24 * 60 * 60 * 1000) < 5_000);
  const concurrentAppealReview = await Promise.allSettled([
    reviewFraudCase({ caseId: manualB.caseId, actorUserId: ops.id, decision: "release", conductAction: "strike", note: "Appeal accepted and prior active representative status restored." }),
    reviewFraudCase({ caseId: manualB.caseId, actorUserId: ops.id, decision: "release", conductAction: "strike", note: "Duplicate appeal decision must be rejected by the row-locked lifecycle." }),
  ]);
  assert.deepEqual(concurrentAppealReview.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const [restoredRep] = await db.select().from(reps).where(eq(reps.id, rep.id)).limit(1);
  assert.equal(restoredRep.status, "active");
  assert.equal(await financialSnapshot(rep.id), beforeConduct);

  const caseHistory = await db.select().from(fraudCaseEvents).where(eq(fraudCaseEvents.caseId, manualB.caseId)).orderBy(fraudCaseEvents.id);
  assert.deepEqual(caseHistory.map((caseEvent) => caseEvent.action), ["opened", "upheld", "appeal_requested", "released"]);
  const historyMutation = await db.update(fraudCaseEvents).set({ note: "Forbidden history rewrite" }).where(eq(fraudCaseEvents.id, caseHistory[0].id)).then(() => null).catch((error) => error);
  assert.ok(historyMutation);
  assert.match(String(historyMutation.cause || historyMutation), /append-only/);
  const historyDelete = await db.delete(fraudCaseEvents).where(eq(fraudCaseEvents.id, caseHistory[0].id)).then(() => null).catch((error) => error);
  assert.ok(historyDelete);
  const caseAudits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "fraud_case"), eq(auditLogs.entityId, String(manualB.caseId))));
  assert.deepEqual(caseAudits.map((audit) => audit.action), ["fraud.case.opened", "fraud.case.upheld", "fraud.case.appeal_requested", "fraud.case.released"]);

  const overdue = await createOperationsFraudCase({ repId: rep.id, actorUserId: ops.id, note: "Deliberate overdue review fixture for record-derived monitoring." });
  await db.update(fraudCases).set({ reviewDueAt: new Date(Date.now() - 60_000) }).where(eq(fraudCases.id, overdue.caseId));
  await monitorOperationalSignals();
  const [incident] = await db.select().from(operationalIncidents).where(eq(operationalIncidents.dedupeKey, `fraud_review:${overdue.caseId}`)).limit(1);
  assert.ok(incident);
  assert.equal(incident.source, "fraud_review");
  assert.equal(incident.severity, "critical");
  await reviewFraudCase({ caseId: overdue.caseId, actorUserId: ops.id, decision: "release", conductAction: "strike", note: "Overdue monitoring fixture reviewed and released without financial mutation." });

  console.log(JSON.stringify({
    status: "passed",
    mode: "sandbox_records",
    defaultCap: { accepted: accepted.length, blockedAt: 11, sameCaseAt: 12, duplicateDidNotIncrement: true },
    concurrentCap: { cap: 1, outcomes: concurrent.map((result) => result.status), cases: concurrentCases.length },
    payoutControls: { assemblyBlocked: true, dispatchBlocked: true, releaseScoped: true, upheldBlocks: true },
    conduct: { suspension: true, appeal: true, priorStatusRestored: true, concurrentDecisionRejected: true },
    financialPreservation: true,
    appendOnlyHistory: caseHistory.map((caseEvent) => caseEvent.action),
    overdueIncident: { source: incident.source, severity: incident.severity },
    references: { capCase: eleventhCaseRef, postReleaseCapCase: secondCaseRef, appealedCase: manualB.caseRef, payableDealId: payableDeal.id },
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
