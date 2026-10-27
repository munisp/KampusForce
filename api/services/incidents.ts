import { and, desc, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  breachAssessments,
  dsarRequests,
  fraudCases,
  jobRuns,
  operationalIncidentEvents,
  operationalIncidents,
  payouts,
  reconciliationRuns,
  supportTickets,
  vendorEvents,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { incidentSeverityForSource, type IncidentSource } from "./incidentPolicy";
import { notifyOperations } from "./notifications";

type IncidentSignal = {
  dedupeKey: string;
  source: IncidentSource;
  title: string;
  detail: string;
  entityType: string;
  entityId: string;
  evidence: Record<string, string | number | boolean | null>;
};

export async function collectOperationalSignals(): Promise<IncidentSignal[]> {
  const db = getDb();
  const now = new Date();
  const [failedJobs, payoutAttention, variances, quarantined, breachedSupport, overdueDsars, overdueBreaches, overdueFraudCases] = await Promise.all([
    db.select().from(jobRuns).where(eq(jobRuns.status, "failed")).orderBy(desc(jobRuns.startedAt)).limit(20),
    db.select().from(payouts).where(inArray(payouts.state, ["failed", "held"])).orderBy(desc(payouts.updatedAt)).limit(50),
    db.select().from(reconciliationRuns).where(eq(reconciliationRuns.state, "variance")).orderBy(desc(reconciliationRuns.createdAt)).limit(50),
    db.select().from(vendorEvents).where(eq(vendorEvents.status, "quarantined")).orderBy(desc(vendorEvents.receivedAt)).limit(30),
    db.select().from(supportTickets).where(and(
      isNotNull(supportTickets.slaBreachedAt),
      notInArray(supportTickets.state, ["resolved", "closed"]),
    )).orderBy(desc(supportTickets.slaBreachedAt)).limit(50),
    db.select().from(dsarRequests).where(and(
      notInArray(dsarRequests.state, ["fulfilled", "rejected"]),
      lt(dsarRequests.dueAt, now),
    )).orderBy(desc(dsarRequests.dueAt)).limit(50),
    db.select().from(breachAssessments).where(and(
      inArray(breachAssessments.state, ["reported", "assessing"]),
      lt(breachAssessments.triageDueAt, now),
    )).orderBy(desc(breachAssessments.triageDueAt)).limit(50),
    db.select().from(fraudCases).where(and(
      inArray(fraudCases.state, ["open", "appeal_open"]),
      lt(fraudCases.reviewDueAt, now),
    )).orderBy(desc(fraudCases.reviewDueAt)).limit(50),
  ]);

  return [
    ...failedJobs.map((job): IncidentSignal => ({
      dedupeKey: `job_failed:${job.id}`,
      source: "job",
      title: `Durable job failed: ${job.jobKey.replaceAll("_", " ")}`,
      detail: `Run #${job.id} failed. Review the privileged job-run record before retrying; the incident does not duplicate raw error output.`,
      entityType: "job_run",
      entityId: String(job.id),
      evidence: { jobKey: job.jobKey, trigger: job.trigger, startedAt: job.startedAt.toISOString() },
    })),
    ...payoutAttention.map((payout): IncidentSignal => ({
      dedupeKey: `payout_attention:${payout.id}`,
      source: "payout",
      title: `Payout #${payout.id} requires Finance review`,
      detail: `Sandbox payout is ${payout.state} after ${payout.attempts} attempt(s). Recovery creates a replacement; failed history is preserved.`,
      entityType: "payout",
      entityId: String(payout.id),
      evidence: { state: payout.state, attempts: payout.attempts, failureCode: payout.lastFailureCode },
    })),
    ...variances.map((run): IncidentSignal => ({
      dedupeKey: `reconciliation_variance:${run.id}`,
      source: "reconciliation",
      title: `Reconciliation variance: ${run.batchId}`,
      detail: `Sandbox reconciliation run #${run.id} exceeded tolerance by ₦${(run.varianceKobo / 100).toLocaleString("en-NG")}. Confirm evidence before resolution.`,
      entityType: "reconciliation_run",
      entityId: String(run.id),
      evidence: { batchId: run.batchId, varianceKobo: run.varianceKobo, evidence: run.evidence },
    })),
    ...quarantined.map((event): IncidentSignal => ({
      dedupeKey: `event_quarantine:${event.id}`,
      source: "event_quarantine",
      title: `Vendor event quarantined: ${event.type.replaceAll("_", " ")}`,
      detail: `Event ${event.id.slice(0, 12)}… requires review. No customer payload is copied into this incident.`,
      entityType: "vendor_event",
      entityId: event.id,
      evidence: { vendorId: event.vendorId, type: event.type, hmacOk: event.hmacOk },
    })),
    ...breachedSupport.map((ticket): IncidentSignal => ({
      dedupeKey: `support_sla:${ticket.id}`,
      source: "support_sla",
      title: `Support SLA breached: ${ticket.ticketRef}`,
      detail: `${ticket.subject} remains in ${ticket.state.replaceAll("_", " ")} after its SLA deadline.`,
      entityType: "support_ticket",
      entityId: String(ticket.id),
      evidence: { ticketRef: ticket.ticketRef, priority: ticket.priority, slaDueAt: ticket.slaDueAt.toISOString() },
    })),
    ...overdueDsars.map((request): IncidentSignal => ({
      dedupeKey: `dsar_sla:${request.id}`,
      source: "dsar_sla",
      title: `DSAR response overdue: ${request.requestRef}`,
      detail: `${request.requestType} request remains in ${request.state.replaceAll("_", " ")} after its 30-day response deadline. No customer identifier is copied into this incident.`,
      entityType: "dsar_request",
      entityId: String(request.id),
      evidence: { requestRef: request.requestRef, requestType: request.requestType, dueAt: request.dueAt.toISOString() },
    })),
    ...overdueBreaches.map((assessment): IncidentSignal => ({
      dedupeKey: `breach_triage:${assessment.id}`,
      source: "breach_triage",
      title: `Breach triage overdue: ${assessment.assessmentRef}`,
      detail: `Assessment remains in ${assessment.state.replaceAll("_", " ")} after its 72-hour triage deadline. Record risk, notification decision and ownership; no external notice is sent here.`,
      entityType: "breach_assessment",
      entityId: String(assessment.id),
      evidence: { assessmentRef: assessment.assessmentRef, triageDueAt: assessment.triageDueAt.toISOString() },
    })),
    ...overdueFraudCases.map((fraudCase): IncidentSignal => ({
      dedupeKey: `fraud_review:${fraudCase.id}`,
      source: "fraud_review",
      title: `Fraud hold review overdue: ${fraudCase.caseRef}`,
      detail: `Case remains in ${fraudCase.state.replaceAll("_", " ")} after its 24-hour review objective. The payout hold remains in force pending an Operations decision.`,
      entityType: "fraud_case",
      entityId: String(fraudCase.id),
      evidence: { caseRef: fraudCase.caseRef, reason: fraudCase.reason, reviewDueAt: fraudCase.reviewDueAt.toISOString() },
    })),
  ];
}

export async function monitorOperationalSignals() {
  const db = getDb();
  const signals = await collectOperationalSignals();
  let created = 0;
  let updated = 0;
  let suppressedResolved = 0;

  for (const signal of signals) {
    const outcome = await db.transaction(async (tx) => {
      const now = new Date();
      const inserted = await tx.insert(operationalIncidents).values({
        dedupeKey: signal.dedupeKey,
        source: signal.source,
        severity: incidentSeverityForSource(signal.source),
        title: signal.title,
        detail: signal.detail,
        entityType: signal.entityType,
        entityId: signal.entityId,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning();
      if (inserted.length) {
        await tx.insert(operationalIncidentEvents).values({
          incidentId: inserted[0].id,
          action: "detected",
          toState: "open",
          note: signal.detail,
          evidenceJson: signal.evidence,
        });
        return { status: "created" as const, incidentId: inserted[0].id };
      }
      const refreshed = await tx.update(operationalIncidents).set({
        title: signal.title,
        detail: signal.detail,
        lastSeenAt: now,
        updatedAt: now,
      }).where(and(
        eq(operationalIncidents.dedupeKey, signal.dedupeKey),
        notInArray(operationalIncidents.state, ["resolved"]),
      )).returning({ id: operationalIncidents.id });
      return refreshed.length
        ? { status: "updated" as const, incidentId: refreshed[0].id }
        : { status: "suppressed_resolved" as const, incidentId: null };
    });

    if (outcome.status === "created") {
      created += 1;
      await notifyOperations({
        type: "operational_incident",
        title: signal.title,
        body: signal.detail,
        href: "/ops",
        entityType: "operational_incident",
        entityId: outcome.incidentId!,
      });
    } else if (outcome.status === "updated") updated += 1;
    else suppressedResolved += 1;
  }

  return { signals: signals.length, created, updated, suppressedResolved, mode: "sandbox_records" as const };
}

export async function listOperationalIncidents() {
  const db = getDb();
  const [incidents, events] = await Promise.all([
    db.select().from(operationalIncidents).orderBy(desc(operationalIncidents.lastSeenAt)).limit(100),
    db.select().from(operationalIncidentEvents).orderBy(desc(operationalIncidentEvents.createdAt)).limit(150),
  ]);
  return { incidents, events };
}

export async function acknowledgeOperationalIncident(incidentId: number, actorUserId: number) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [incident] = await tx.select().from(operationalIncidents).where(eq(operationalIncidents.id, incidentId)).limit(1).for("update");
    if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Operational incident not found" });
    if (incident.state !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "Only open incidents can be acknowledged" });
    const now = new Date();
    await tx.update(operationalIncidents).set({
      state: "acknowledged",
      acknowledgedByUserId: actorUserId,
      acknowledgedAt: now,
      updatedAt: now,
    }).where(eq(operationalIncidents.id, incidentId));
    await tx.insert(operationalIncidentEvents).values({
      incidentId,
      actorUserId,
      action: "acknowledged",
      fromState: "open",
      toState: "acknowledged",
      note: "Operations accepted ownership of the incident.",
    });
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "operational_incident.acknowledged",
      entityType: "operational_incident",
      entityId: String(incidentId),
      metadataJson: { source: incident.source, severity: incident.severity },
    });
    return { incidentId, state: "acknowledged" as const, acknowledgedAt: now };
  });
}

export async function resolveOperationalIncident(incidentId: number, actorUserId: number, resolutionNote: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [incident] = await tx.select().from(operationalIncidents).where(eq(operationalIncidents.id, incidentId)).limit(1).for("update");
    if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Operational incident not found" });
    if (incident.state === "resolved") throw new TRPCError({ code: "BAD_REQUEST", message: "Incident is already resolved" });
    const now = new Date();
    await tx.update(operationalIncidents).set({
      state: "resolved",
      resolvedByUserId: actorUserId,
      resolvedAt: now,
      resolutionNote,
      updatedAt: now,
    }).where(eq(operationalIncidents.id, incidentId));
    await tx.insert(operationalIncidentEvents).values({
      incidentId,
      actorUserId,
      action: "resolved",
      fromState: incident.state,
      toState: "resolved",
      note: resolutionNote,
    });
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "operational_incident.resolved",
      entityType: "operational_incident",
      entityId: String(incidentId),
      metadataJson: { source: incident.source, previousState: incident.state },
    });
    return { incidentId, state: "resolved" as const, resolvedAt: now };
  });
}
