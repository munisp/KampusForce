import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  auditLogs,
  breachAssessmentEvents,
  breachAssessments,
  campusLeadOverrides,
  consentLogs,
  deals,
  dsarRequestEvents,
  dsarRequests,
  escrowWallets,
  ledgerEntries,
  operationalIncidents,
  payoutAttempts,
  payouts,
  products,
  reconciliationRuns,
  reps,
  users,
  vendors,
} from "../db/schema";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent } from "../api/services/events";
import { createSupportTicket } from "../api/services/support";
import { hashPhone } from "../api/services/security";
import {
  closeBreachAssessment,
  createBreachAssessment,
  createDsarRequest,
  exportDsarEvidence,
  fulfilDsarRequest,
  recordBreachDecision,
  startBreachAssessment,
  startDsarReview,
  verifyDsarIdentity,
} from "../api/services/privacy";
import { monitorOperationalSignals } from "../api/services/incidents";

const db = getDb();
const uniquePhone = () => `+2348${String(randomInt(1_000_000_000)).padStart(9, "0")}`;

async function financialSnapshot() {
  const [dealRows, ledgerRows, payoutRows, attemptRows, reconciliationRows, walletRows, overrideRows] = await Promise.all([
    db.select().from(deals).orderBy(deals.id),
    db.select().from(ledgerEntries).orderBy(ledgerEntries.id),
    db.select().from(payouts).orderBy(payouts.id),
    db.select().from(payoutAttempts).orderBy(payoutAttempts.id),
    db.select().from(reconciliationRuns).orderBy(reconciliationRuns.id),
    db.select().from(escrowWallets).orderBy(escrowWallets.vendorId),
    db.select().from(campusLeadOverrides).orderBy(campusLeadOverrides.id),
  ]);
  return JSON.stringify({ dealRows, ledgerRows, payoutRows, attemptRows, reconciliationRows, walletRows, overrideRows });
}

function assertSingleSuccess(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
}

async function assertAppendOnly(error: unknown) {
  assert.ok(error);
  assert.match(String((error as { cause?: unknown }).cause || error), /append-only/);
}

async function main() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [rep] = await db.select().from(reps).orderBy(reps.id).limit(1);
  const [repUser] = rep ? await db.select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  assert.ok(ops && rep && repUser && product && vendor);

  const customerPhone = uniquePhone();
  const sensitiveFreeText = `Raw ${customerPhone} and identity value 12345678901 must not leave this support record.`;
  await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone, source: "assisted", actorUserId: repUser.id });
  const event = await ingestVendorEvent(vendor.webhookKey, {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: customerPhone, customer_ref: `phase7-${crypto.randomUUID()}` },
    product_ref: product.vendorRef,
    amount_kobo: 500_000,
    meta: { verification: "phase7_privacy" },
  });
  assert.equal(event.status, "accepted");
  assert.ok("deal_id" in event && event.deal_id);
  const ticket = await createSupportTicket({
    actorUserId: repUser.id,
    repId: rep.id,
    dealId: event.deal_id!,
    category: "privacy",
    subject: "Sensitive free text excluded from DSAR metadata",
    description: sensitiveFreeText,
    priority: "urgent",
  });
  await db.insert(consentLogs).values({
    actorUserId: repUser.id,
    phoneHash: hashPhone(customerPhone),
    purpose: "phase7_assisted_onboarding",
    policyVersion: "sandbox-v1",
  });

  const beforePrivacy = await financialSnapshot();
  const receivedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const dsar = await createDsarRequest({ actorUserId: ops.id, customerPhone, requestType: "access", receivedAt });
  assert.equal(dsar.dueAt.getTime(), receivedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [storedDsar] = await db.select().from(dsarRequests).where(eq(dsarRequests.id, dsar.requestId)).limit(1);
  assert.equal(storedDsar.customerPhoneHash, hashPhone(customerPhone));
  assert.equal(storedDsar.customerPhoneHash.length, 64);
  assert.ok(!JSON.stringify(storedDsar).includes(customerPhone));
  await assert.rejects(() => exportDsarEvidence(dsar.requestId, ops.id), /Verify the requester's identity/);

  const verification = await Promise.allSettled([
    verifyDsarIdentity(dsar.requestId, ops.id, "Sandbox identity evidence reviewed by authorized Operations staff."),
    verifyDsarIdentity(dsar.requestId, ops.id, "Concurrent duplicate verification must be rejected by the row lock."),
  ]);
  assertSingleSuccess(verification);
  const reviewed = await startDsarReview(dsar.requestId, ops.id);
  assert.equal(reviewed.state, "in_review");

  const exported = await exportDsarEvidence(dsar.requestId, ops.id);
  assert.ok(exported.fileName.endsWith("-evidence.json"));
  assert.ok(exported.evidence.records.attributions.length >= 1);
  assert.ok(exported.evidence.records.activations.length >= 1);
  assert.ok(exported.evidence.records.support.some((row) => row.ticketRef === ticket.ticketRef));
  assert.ok(exported.evidence.records.consent.length >= 1);
  const serializedExport = JSON.stringify(exported.evidence);
  assert.ok(!serializedExport.includes(customerPhone));
  assert.ok(!serializedExport.includes("12345678901"));
  assert.ok(!serializedExport.includes(ticket.subject));
  assert.ok(!serializedExport.includes("must not leave this support record"));
  const forbiddenKeys = new Set([
    "phoneE164", "ninToken", "ninLast4", "bvn", "bankName", "bankCode", "bankAccountName",
    "repCommissionKobo", "vendorCommissionKobo", "platformFeeKobo", "tokenSig", "payloadJson",
    "description", "csatComment", "subject",
  ]);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!forbiddenKeys.has(key), `Forbidden export key: ${key}`);
      walk(nested);
    }
  };
  walk(exported.evidence);

  const detectedAt = new Date(Date.now() - 73 * 60 * 60 * 1000);
  const breach = await createBreachAssessment({
    actorUserId: ops.id,
    title: "Phase Seven sandbox breach assessment",
    summary: "Deliberate test fixture for triage timing, ownership and notification-decision controls.",
    detectedAt,
  });
  assert.equal(breach.triageDueAt.getTime(), detectedAt.getTime() + 72 * 60 * 60 * 1000);
  await assert.rejects(() => recordBreachDecision({
    assessmentId: breach.assessmentId,
    actorUserId: ops.id,
    risk: "high",
    notificationDecision: "required",
    notificationOwnerUserId: ops.id,
    decisionNote: "A decision before triage starts must be rejected.",
  }), /Start the assessment/);
  const assessmentStarts = await Promise.allSettled([
    startBreachAssessment(breach.assessmentId, ops.id),
    startBreachAssessment(breach.assessmentId, ops.id),
  ]);
  assertSingleSuccess(assessmentStarts);
  await assert.rejects(() => recordBreachDecision({
    assessmentId: breach.assessmentId,
    actorUserId: ops.id,
    risk: "high",
    notificationDecision: "required",
    notificationOwnerUserId: repUser.id,
    decisionNote: "A representative cannot own regulatory notification decisions.",
  }), /Operations or Admin/);

  const monitored = await monitorOperationalSignals();
  assert.ok(monitored.created >= 2);
  const privacyIncidents = await db.select().from(operationalIncidents).where(inArray(operationalIncidents.dedupeKey, [
    `dsar_sla:${dsar.requestId}`,
    `breach_triage:${breach.assessmentId}`,
  ]));
  assert.equal(privacyIncidents.length, 2);
  assert.equal(privacyIncidents.find((incident) => incident.source === "dsar_sla")?.severity, "warning");
  assert.equal(privacyIncidents.find((incident) => incident.source === "breach_triage")?.severity, "critical");
  assert.ok(!JSON.stringify(privacyIncidents).includes(customerPhone));
  await monitorOperationalSignals();
  const dedupedIncidents = await db.select().from(operationalIncidents).where(inArray(operationalIncidents.dedupeKey, [
    `dsar_sla:${dsar.requestId}`,
    `breach_triage:${breach.assessmentId}`,
  ]));
  assert.equal(dedupedIncidents.length, 2);

  const decision = await recordBreachDecision({
    assessmentId: breach.assessmentId,
    actorUserId: ops.id,
    risk: "high",
    notificationDecision: "required",
    notificationOwnerUserId: ops.id,
    decisionNote: "High-risk sandbox assessment; authorized Operations owner must handle any external notice separately.",
  });
  assert.equal(decision.externalNotificationSent, false);
  const closed = await closeBreachAssessment(breach.assessmentId, ops.id, "Decision and ownership recorded; no external notification was sent by the sandbox.");
  assert.equal(closed.externalNotificationSent, false);
  await assert.rejects(() => closeBreachAssessment(breach.assessmentId, ops.id, "Duplicate closure must be rejected."), /Record the risk and notification decision/);
  const fulfilled = await fulfilDsarRequest(dsar.requestId, ops.id, "Scoped metadata export reviewed and fulfilled without altering financial history.");
  assert.equal(fulfilled.state, "fulfilled");
  await assert.rejects(() => fulfilDsarRequest(dsar.requestId, ops.id, "Duplicate fulfilment must be rejected."), /cannot move/);

  const [dsarHistory, breachHistory] = await Promise.all([
    db.select().from(dsarRequestEvents).where(eq(dsarRequestEvents.requestId, dsar.requestId)).orderBy(dsarRequestEvents.id),
    db.select().from(breachAssessmentEvents).where(eq(breachAssessmentEvents.assessmentId, breach.assessmentId)).orderBy(breachAssessmentEvents.id),
  ]);
  assert.deepEqual(dsarHistory.map((event) => event.action), ["received", "identity_verified", "review_started", "evidence_exported", "fulfilled"]);
  assert.deepEqual(breachHistory.map((event) => event.action), ["reported", "assessment_started", "decision_recorded", "closed"]);
  const dsarMutation = await db.update(dsarRequestEvents).set({ note: "Forbidden rewrite" }).where(eq(dsarRequestEvents.id, dsarHistory[0].id)).then(() => null).catch((error) => error);
  await assertAppendOnly(dsarMutation);
  const breachMutation = await db.delete(breachAssessmentEvents).where(eq(breachAssessmentEvents.id, breachHistory[0].id)).then(() => null).catch((error) => error);
  await assertAppendOnly(breachMutation);

  const [dsarAudits, breachAudits, breachRows] = await Promise.all([
    db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "dsar_request"), eq(auditLogs.entityId, String(dsar.requestId)))),
    db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "breach_assessment"), eq(auditLogs.entityId, String(breach.assessmentId)))),
    db.select().from(breachAssessments).where(eq(breachAssessments.id, breach.assessmentId)).limit(1),
  ]);
  assert.ok(dsarAudits.length >= 5);
  assert.ok(breachAudits.length >= 4);
  const [storedBreach] = breachRows;
  assert.equal(storedBreach.notificationOwnerUserId, ops.id);
  assert.equal(storedBreach.notificationDecision, "required");
  assert.equal(storedBreach.state, "closed");
  assert.equal(await financialSnapshot(), beforePrivacy);

  console.log(JSON.stringify({
    status: "passed",
    mode: "sandbox_records",
    dsar: {
      requestRef: dsar.requestRef,
      responseWindowDays: 30,
      hashedCustomerOnly: true,
      concurrentTransitionRejected: true,
      lifecycle: dsarHistory.map((event) => event.action),
      evidenceCounts: {
        attributions: exported.evidence.records.attributions.length,
        activations: exported.evidence.records.activations.length,
        support: exported.evidence.records.support.length,
        consent: exported.evidence.records.consent.length,
      },
      sensitiveValuesExcluded: true,
    },
    breach: {
      assessmentRef: breach.assessmentRef,
      triageWindowHours: 72,
      ownerRoleEnforced: true,
      lifecycle: breachHistory.map((event) => event.action),
      externalNotificationSent: false,
    },
    overdueIncidentSources: privacyIncidents.map((incident) => incident.source).sort(),
    appendOnlyHistories: true,
    financialRecordsUnchanged: true,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
