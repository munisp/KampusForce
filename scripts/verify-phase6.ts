import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt, randomUUID, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  auditLogs,
  jobRuns,
  notifications,
  operationalIncidentEvents,
  operationalIncidents,
  payouts,
  products,
  reconciliationRuns,
  reps,
  supportTickets,
  users,
  vendorEvents,
  vendors,
} from "../db/schema";
import { acknowledgeOperationalIncident, monitorOperationalSignals, resolveOperationalIncident } from "../api/services/incidents";
import { monitoringSlotKey } from "../api/services/incidentPolicy";
import { runDurableJob } from "../api/services/jobs";

const db = getDb();
const hash = () => createHash("sha256").update(crypto.randomUUID()).digest("hex");

async function main() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [rep] = await db.select().from(reps).orderBy(reps.id).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  assert.ok(ops && rep && vendor && product);

  const suffix = crypto.randomUUID();
  const [failedJob] = await db.insert(jobRuns).values({
    jobKey: "phase6_deliberate_probe",
    slotKey: `phase6-${suffix}`,
    trigger: "manual",
    status: "failed",
    finishedAt: new Date(),
    error: "Deliberate sandbox monitoring fixture",
  }).returning();
  const [failedPayout] = await db.insert(payouts).values({
    repId: rep.id,
    amountGrossKobo: 100_000,
    amountNetKobo: 90_000,
    withholdingKobo: 10_000,
    provider: "paystack_sandbox",
    providerRef: `phase6-payout-${suffix}`,
    state: "failed",
    batchId: `phase6-${suffix.slice(0, 18)}`,
    attempts: 3,
    lastFailureCode: "phase6_deliberate_failure",
  }).returning();
  const [variance] = await db.insert(reconciliationRuns).values({
    batchId: failedPayout.batchId,
    actorUserId: ops.id,
    ledgerKobo: 100_000,
    providerKobo: 100_000,
    bankKobo: 0,
    varianceKobo: 100_000,
    state: "variance",
  }).returning();
  const [quarantine] = await db.insert(vendorEvents).values({
    id: crypto.randomUUID(),
    vendorId: vendor.id,
    type: "funded",
    customerRefHash: hash(),
    productId: product.id,
    amountKobo: 500_000,
    payloadJson: { fixture: "phase6", customer: "redacted" },
    hmacOk: false,
    dedupeKey: `phase6-event-${suffix}`,
    status: "quarantined",
    quarantineReason: "Deliberate sandbox quarantine fixture",
  }).returning();
  const [breach] = await db.insert(supportTickets).values({
    ticketRef: `KF-P6-${randomInt(100000, 999999)}`,
    repId: rep.id,
    vendorId: vendor.id,
    customerPhoneHash: hash(),
    category: "settlement",
    subject: "Phase Six monitoring fixture",
    description: "Deliberate sandbox SLA breach used to verify operational monitoring.",
    priority: "urgent",
    state: "ops_queue",
    slaDueAt: new Date(Date.now() - 60_000),
    slaBreachedAt: new Date(),
  }).returning();

  const expectedKeys = [
    `job_failed:${failedJob.id}`,
    `payout_attention:${failedPayout.id}`,
    `reconciliation_variance:${variance.id}`,
    `event_quarantine:${quarantine.id}`,
    `support_sla:${breach.id}`,
  ];
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => monitorOperationalSignals()));
  const incidents = await db.select().from(operationalIncidents).where(inArray(operationalIncidents.dedupeKey, expectedKeys));
  assert.equal(incidents.length, 5);
  assert.deepEqual(new Set(incidents.map((incident) => incident.severity)), new Set(["critical", "warning"]));
  const incidentIds = incidents.map((incident) => incident.id);
  const detected = await db.select().from(operationalIncidentEvents).where(and(
    inArray(operationalIncidentEvents.incidentId, incidentIds),
    eq(operationalIncidentEvents.action, "detected"),
  ));
  assert.equal(detected.length, 5);
  const notices = await db.select().from(notifications).where(and(
    eq(notifications.type, "operational_incident"),
    inArray(notifications.entityId, incidentIds.map(String)),
  ));
  assert.ok(notices.length >= 5);
  assert.ok(concurrent.reduce((sum, result) => sum + result.created, 0) >= 5);

  const repeat = await monitorOperationalSignals();
  assert.equal(repeat.created, 0);
  const jobIncident = incidents.find((incident) => incident.dedupeKey === `job_failed:${failedJob.id}`)!;
  const acknowledged = await acknowledgeOperationalIncident(jobIncident.id, ops.id);
  assert.equal(acknowledged.state, "acknowledged");
  await assert.rejects(() => acknowledgeOperationalIncident(jobIncident.id, ops.id), /Only open incidents/);
  const resolved = await resolveOperationalIncident(jobIncident.id, ops.id, "Deliberate fixture reviewed; no production impact and no further action required.");
  assert.equal(resolved.state, "resolved");
  await assert.rejects(() => resolveOperationalIncident(jobIncident.id, ops.id, "Duplicate resolution attempt rejected."), /already resolved/);

  const history = await db.select().from(operationalIncidentEvents).where(eq(operationalIncidentEvents.incidentId, jobIncident.id)).orderBy(operationalIncidentEvents.id);
  assert.deepEqual(history.map((event) => event.action), ["detected", "acknowledged", "resolved"]);
  const audits = await db.select().from(auditLogs).where(and(
    eq(auditLogs.entityType, "operational_incident"),
    eq(auditLogs.entityId, String(jobIncident.id)),
  ));
  assert.equal(audits.length, 2);
  const historyMutation = await db.update(operationalIncidentEvents).set({ note: "Forbidden history rewrite" }).where(eq(operationalIncidentEvents.id, history[0].id)).then(() => null).catch((error) => error);
  assert.ok(historyMutation);
  assert.match(String(historyMutation.cause || historyMutation), /append-only/);

  const afterResolved = await monitorOperationalSignals();
  assert.ok(afterResolved.suppressedResolved >= 1);
  const [jobAfter] = await db.select().from(operationalIncidents).where(eq(operationalIncidents.id, jobIncident.id)).limit(1);
  assert.equal(jobAfter.state, "resolved");
  const [detectedAfter] = await db.select().from(operationalIncidentEvents).where(and(
    eq(operationalIncidentEvents.incidentId, jobIncident.id),
    eq(operationalIncidentEvents.action, "detected"),
  ));
  assert.ok(detectedAfter);

  const slot = `${monitoringSlotKey(new Date())}:verify:${randomUUID()}`;
  const scheduled = await Promise.all([
    runDurableJob("monitoring_sweep", "schedule", slot),
    runDurableJob("monitoring_sweep", "schedule", slot),
  ]);
  assert.deepEqual(scheduled.map((result) => result.status).sort(), ["skipped_duplicate", "succeeded"]);
  const slotRuns = await db.select().from(jobRuns).where(and(eq(jobRuns.jobKey, "monitoring_sweep"), eq(jobRuns.slotKey, slot)));
  assert.equal(slotRuns.length, 1);

  console.log(JSON.stringify({
    status: "passed",
    mode: "sandbox_records",
    signalSources: incidents.map((incident) => incident.source).sort(),
    concurrentDetectionEvents: detected.length,
    duplicateDetectionPrevented: true,
    operationsNotifications: notices.length,
    lifecycle: history.map((event) => event.action),
    appendOnlyEvents: true,
    resolvedIncidentsStayResolved: true,
    scheduledSlotDeduplicated: true,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
