import { asc, desc, eq } from "drizzle-orm";
import {
  auditLogs,
  campusCohorts,
  campuses,
  deals,
  disputes,
  payouts,
  reps,
  rolloutEvidence,
  rolloutEvidenceEvents,
  rolloutQuarters,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { evaluateRolloutGates, gateCatalog, type RolloutMetricUnit } from "./rolloutPolicy";

type SubjectType = "campus_cohort" | "phase_quarter";

function safeText(value: string, label: string, min: number, max: number) {
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${label} must be ${min}–${max} characters`);
  if (/(?:bearer\s+\S+|sk_live_|github_pat_|ghp_|(?:secret|password|api[_-]?key|access[_-]?token)\s*[:=])/i.test(text)) {
    throw new Error(`${label} must not contain credentials or secret values`);
  }
  if (/(?:raw\s+(?:nin|bvn)|account[_ ]number\s*[:=])/i.test(text)) {
    throw new Error(`${label} must reference evidence without raw identity or bank-account values`);
  }
  return text;
}

function calendarDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${label} must be a valid ISO calendar date`);
  return value;
}

function assertCalendarMonth(start: string, end: string) {
  const from = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (from.getUTCDate() !== 1 || from.getUTCFullYear() !== endDate.getUTCFullYear() || from.getUTCMonth() !== endDate.getUTCMonth()) {
    throw new Error("A campus cohort must cover one calendar month");
  }
  if (new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() + 1)).getUTCDate() !== 1) {
    throw new Error("Month one must end on the final day of the cohort calendar month");
  }
}

function assertCalendarQuarter(start: string, end: string) {
  const from = new Date(`${start}T00:00:00Z`);
  if (from.getUTCDate() !== 1 || ![0, 3, 6, 9].includes(from.getUTCMonth())) throw new Error("A rollout quarter must start on a calendar-quarter boundary");
  const expectedEnd = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 3, 0));
  if (end !== expectedEnd.toISOString().slice(0, 10)) throw new Error("A rollout quarter must cover the complete calendar quarter");
}

async function subject(subjectType: SubjectType, subjectId: number) {
  if (subjectType === "campus_cohort") {
    const [row] = await getDb().select().from(campusCohorts).where(eq(campusCohorts.id, subjectId)).limit(1);
    if (!row) throw new Error("Campus cohort not found");
    return { row, periodStartDate: row.cohortStartDate, periodEndDate: row.monthOneEndDate, definitions: gateCatalog(subjectType) };
  }
  const [row] = await getDb().select().from(rolloutQuarters).where(eq(rolloutQuarters.id, subjectId)).limit(1);
  if (!row) throw new Error("Rollout quarter not found");
  return { row, periodStartDate: row.quarterStartDate, periodEndDate: row.quarterEndDate, definitions: gateCatalog(subjectType, row.phase) };
}

export async function createCampusCohort(input: {
  campusId: number;
  label: string;
  cohortStartDate: string;
  monthOneEndDate: string;
  actorUserId: number;
}) {
  const label = safeText(input.label, "Cohort label", 3, 120);
  calendarDate(input.cohortStartDate, "Cohort start");
  calendarDate(input.monthOneEndDate, "Month-one end");
  assertCalendarMonth(input.cohortStartDate, input.monthOneEndDate);
  const [campus] = await getDb().select({ id: campuses.id }).from(campuses).where(eq(campuses.id, input.campusId)).limit(1);
  if (!campus) throw new Error("Campus not found");
  return getDb().transaction(async (tx) => {
    const [cohort] = await tx.insert(campusCohorts).values({
      campusId: input.campusId,
      label,
      cohortStartDate: input.cohortStartDate,
      monthOneEndDate: input.monthOneEndDate,
      createdByUserId: input.actorUserId,
    }).returning();
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "rollout.campus_cohort_created", entityType: "campus_cohort", entityId: String(cohort.id), metadataJson: { campusId: cohort.campusId, label, realWorldOutcomeCertified: false } });
    return { ...cohort, campusStatusChanged: false, realWorldOutcomeCertified: false };
  });
}

export async function createRolloutQuarter(input: {
  phase: number;
  label: string;
  quarterStartDate: string;
  quarterEndDate: string;
  actorUserId: number;
}) {
  if (![1, 2, 3].includes(input.phase)) throw new Error("Rollout phase must be 1, 2 or 3");
  const label = safeText(input.label, "Quarter label", 3, 120);
  calendarDate(input.quarterStartDate, "Quarter start");
  calendarDate(input.quarterEndDate, "Quarter end");
  assertCalendarQuarter(input.quarterStartDate, input.quarterEndDate);
  return getDb().transaction(async (tx) => {
    const [quarter] = await tx.insert(rolloutQuarters).values({
      phase: input.phase,
      label,
      quarterStartDate: input.quarterStartDate,
      quarterEndDate: input.quarterEndDate,
      createdByUserId: input.actorUserId,
    }).returning();
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "rollout.phase_quarter_created", entityType: "rollout_quarter", entityId: String(quarter.id), metadataJson: { phase: quarter.phase, fullQuarterRequired: true, nationalLaunchCertified: false } });
    return { ...quarter, nationalLaunchCertified: false };
  });
}

export async function submitExternalRolloutEvidence(input: {
  subjectType: SubjectType;
  subjectId: number;
  metricKey: string;
  metricValue: number;
  periodStartDate: string;
  periodEndDate: string;
  evidenceReference: string;
  note: string;
  realWorldAttested: boolean;
  actorUserId: number;
}) {
  if (!input.realWorldAttested) throw new Error("External evidence requires an explicit real-world attestation; fixtures and system observations are ineligible");
  if (!Number.isFinite(input.metricValue)) throw new Error("Metric value must be finite");
  const target = await subject(input.subjectType, input.subjectId);
  const definition = target.definitions.find((gate) => gate.key === input.metricKey);
  if (!definition) throw new Error("Metric is not part of this evidence subject");
  if (definition.key !== "ebitdaKobo" && input.metricValue < 0) throw new Error("Metric value cannot be negative");
  calendarDate(input.periodStartDate, "Evidence period start");
  calendarDate(input.periodEndDate, "Evidence period end");
  if (input.periodStartDate > input.periodEndDate) throw new Error("Evidence period start cannot be after its end");
  const evidenceReference = safeText(input.evidenceReference, "Evidence reference", 3, 500);
  if (/(?:^|[_\s-])(?:seed|seeded|fixture|sandbox|system.generated)(?:$|[_\s-])/i.test(evidenceReference)) {
    throw new Error("Seeded, fixture, sandbox and system-generated references cannot be submitted as real-world evidence");
  }
  const note = safeText(input.note, "Evidence note", 10, 2000);
  return getDb().transaction(async (tx) => {
    const [evidence] = await tx.insert(rolloutEvidence).values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metricKey: definition.key,
      sourceType: "external_evidence",
      realWorldAttested: true,
      state: "submitted",
      metricValue: String(input.metricValue),
      unit: definition.unit,
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
      evidenceReference,
      note,
      submittedByUserId: input.actorUserId,
    }).returning();
    await tx.insert(rolloutEvidenceEvents).values({
      evidenceId: evidence.id,
      actorUserId: input.actorUserId,
      action: "external_evidence_submitted",
      toState: "submitted",
      note,
      evidenceJson: { evidenceReference, realWorldAttested: true, externalSystemVerified: false },
    });
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "rollout.external_evidence_submitted", entityType: input.subjectType, entityId: String(input.subjectId), metadataJson: { evidenceId: evidence.id, metricKey: definition.key, independentReviewRequired: true } });
    return { evidenceId: evidence.id, state: "submitted" as const, independentReviewRequired: true, campusStatusChanged: false, nationalLaunchCertified: false };
  });
}

export async function reviewRolloutEvidence(input: {
  evidenceId: number;
  decision: "approved" | "rejected";
  reviewReference: string;
  note: string;
  realWorldReviewAttested: boolean;
  actorUserId: number;
}) {
  if (!input.realWorldReviewAttested) throw new Error("Independent review requires an explicit attestation that real-world evidence was examined");
  const reviewReference = safeText(input.reviewReference, "Review reference", 3, 500);
  const note = safeText(input.note, "Review note", 10, 2000);
  return getDb().transaction(async (tx) => {
    const [evidence] = await tx.select().from(rolloutEvidence).where(eq(rolloutEvidence.id, input.evidenceId)).limit(1).for("update");
    if (!evidence) throw new Error("Rollout evidence not found");
    if (evidence.sourceType !== "external_evidence" || !evidence.realWorldAttested) throw new Error("System snapshots are ineligible for real-world evidence approval");
    if (evidence.state !== "submitted") throw new Error("Only submitted external evidence can be reviewed");
    if (evidence.submittedByUserId === input.actorUserId) throw new Error("Independent review is required; the evidence submitter cannot review their own rollout evidence");
    const now = new Date();
    await tx.update(rolloutEvidence).set({
      state: input.decision,
      reviewedByUserId: input.actorUserId,
      reviewedAt: now,
      reviewReference,
      reviewNote: note,
      updatedAt: now,
    }).where(eq(rolloutEvidence.id, evidence.id));
    await tx.insert(rolloutEvidenceEvents).values({
      evidenceId: evidence.id,
      actorUserId: input.actorUserId,
      action: input.decision === "approved" ? "external_evidence_approved" : "external_evidence_rejected",
      fromState: evidence.state,
      toState: input.decision,
      note,
      evidenceJson: { reviewReference, realWorldReviewAttested: true, externalSystemVerified: false },
    });
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: `rollout.evidence_${input.decision}`, entityType: evidence.subjectType, entityId: String(evidence.subjectId), metadataJson: { evidenceId: evidence.id, metricKey: evidence.metricKey, independentReview: true, campusStatusChanged: false, nationalLaunchCertified: false } });
    return { evidenceId: evidence.id, state: input.decision, externalSystemVerified: false, campusStatusChanged: false, nationalLaunchCertified: false };
  });
}

async function insertSystemSnapshots(input: {
  subjectType: SubjectType;
  subjectId: number;
  periodStartDate: string;
  periodEndDate: string;
  actorUserId: number;
  rows: { metricKey: string; value: number; unit: RolloutMetricUnit; note: string }[];
}) {
  return getDb().transaction(async (tx) => {
    const ids: number[] = [];
    for (const row of input.rows) {
      const note = `${row.note} System-generated sandbox observation; ineligible for real-world gate attainment.`;
      const [evidence] = await tx.insert(rolloutEvidence).values({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        metricKey: row.metricKey,
        sourceType: "system_snapshot",
        realWorldAttested: false,
        state: "recorded",
        metricValue: String(row.value),
        unit: row.unit,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        evidenceReference: `system-snapshot-${input.subjectType}-${input.subjectId}-${Date.now()}`,
        note,
        submittedByUserId: input.actorUserId,
      }).returning();
      ids.push(evidence.id);
      await tx.insert(rolloutEvidenceEvents).values({ evidenceId: evidence.id, actorUserId: input.actorUserId, action: "system_snapshot_recorded", toState: "recorded", note, evidenceJson: { realWorldAttested: false, gateEligible: false } });
    }
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "rollout.system_snapshot_recorded", entityType: input.subjectType, entityId: String(input.subjectId), metadataJson: { evidenceIds: ids, gateEligible: false } });
    return { evidenceIds: ids, gateEligible: false, realWorldOutcomeCertified: false };
  });
}

export async function captureCampusCohortSnapshot(cohortId: number, actorUserId: number) {
  const target = await subject("campus_cohort", cohortId);
  const cohort = target.row as typeof campusCohorts.$inferSelect;
  const [campusReps, allDeals] = await Promise.all([
    getDb().select().from(reps).where(eq(reps.campusId, cohort.campusId)),
    getDb().select().from(deals),
  ]);
  const start = new Date(`${cohort.cohortStartDate}T00:00:00Z`).getTime();
  const end = new Date(`${cohort.monthOneEndDate}T23:59:59.999Z`).getTime();
  const repIds = new Set(campusReps.map((rep) => rep.id));
  const confirmed = allDeals.filter((deal) => repIds.has(deal.repId) && ["confirmed", "payable", "paid"].includes(deal.state) && deal.createdAt.getTime() >= start && deal.createdAt.getTime() <= end);
  const activeReps = campusReps.filter((rep) => rep.status === "active").length;
  const activatedReps = new Set(confirmed.map((deal) => deal.repId)).size;
  return insertSystemSnapshots({ subjectType: "campus_cohort", subjectId: cohortId, periodStartDate: cohort.cohortStartDate, periodEndDate: cohort.monthOneEndDate, actorUserId, rows: [
    { metricKey: "verifiedReps", value: activeReps, unit: "count", note: "Active sandbox representative profiles; this does not verify real identity or cohort membership." },
    { metricKey: "monthOneActivations", value: confirmed.length, unit: "count", note: "Confirmed sandbox deals in the selected calendar month." },
    { metricKey: "firstActivationRate", value: campusReps.length ? activatedReps / campusReps.length * 100 : 0, unit: "percent", note: "Sandbox representatives with a confirmed deal divided by sandbox campus profiles." },
  ] });
}

export async function captureRolloutQuarterSnapshot(quarterId: number, actorUserId: number) {
  const target = await subject("phase_quarter", quarterId);
  const quarter = target.row as typeof rolloutQuarters.$inferSelect;
  const [allReps, allDeals, allPayouts, allDisputes, allCampuses, allVendors] = await Promise.all([
    getDb().select().from(reps), getDb().select().from(deals), getDb().select().from(payouts), getDb().select().from(disputes), getDb().select().from(campuses), getDb().select().from(vendors),
  ]);
  const activeReps = allReps.filter((rep) => rep.status === "active").length;
  const confirmed = allDeals.filter((deal) => ["confirmed", "payable", "paid"].includes(deal.state));
  const paid = allPayouts.filter((payout) => payout.state === "paid" && payout.paidAt);
  const within48 = paid.filter((payout) => payout.paidAt!.getTime() - payout.createdAt.getTime() <= 48 * 60 * 60 * 1000).length;
  return insertSystemSnapshots({ subjectType: "phase_quarter", subjectId: quarterId, periodStartDate: quarter.quarterStartDate, periodEndDate: quarter.quarterEndDate, actorUserId, rows: [
    { metricKey: "activeRecruitRate", value: allReps.length ? activeReps / allReps.length * 100 : 0, unit: "percent", note: "Active sandbox profiles divided by all sandbox representative profiles." },
    { metricKey: "activationsPerActiveRep", value: activeReps ? confirmed.length / activeReps / 3 : 0, unit: "ratio", note: "Three-month average derived from sandbox confirmed deals and active profiles." },
    { metricKey: "payoutsWithin48hRate", value: paid.length ? within48 / paid.length * 100 : 0, unit: "percent", note: "Sandbox paid payouts within 48 hours of payout creation, not authenticated bank evidence." },
    { metricKey: "disputeRate", value: allDeals.length ? allDisputes.length / allDeals.length * 100 : 0, unit: "percent", note: "Sandbox dispute records divided by sandbox deals." },
    { metricKey: "cumulativeActivations", value: confirmed.length, unit: "count", note: "Cumulative confirmed sandbox deals." },
    { metricKey: "campusCount", value: allCampuses.length, unit: "count", note: "Campus fixture count, not real campus launches." },
    { metricKey: "activeVendors", value: allVendors.filter((vendor) => vendor.status === "active").length, unit: "count", note: "Active sandbox vendor profiles, not production vendor cutovers." },
  ] });
}

export async function getRolloutReadiness() {
  const [cohortRows, quarterRows, campusRows, evidence, eventRows] = await Promise.all([
    getDb().select().from(campusCohorts).orderBy(desc(campusCohorts.createdAt)),
    getDb().select().from(rolloutQuarters).orderBy(asc(rolloutQuarters.phase), desc(rolloutQuarters.quarterStartDate)),
    getDb().select().from(campuses).orderBy(asc(campuses.name)),
    getDb().select().from(rolloutEvidence).orderBy(desc(rolloutEvidence.submittedAt), desc(rolloutEvidence.id)),
    getDb().select({ event: rolloutEvidenceEvents, actorName: users.name }).from(rolloutEvidenceEvents).innerJoin(users, eq(rolloutEvidenceEvents.actorUserId, users.id)).orderBy(desc(rolloutEvidenceEvents.createdAt)).limit(300),
  ]);
  const cohorts = cohortRows.map((cohort) => ({
    ...cohort,
    campus: campusRows.find((campus) => campus.id === cohort.campusId),
    evaluation: evaluateRolloutGates({ definitions: gateCatalog("campus_cohort"), evidence: evidence.filter((row) => row.subjectType === "campus_cohort" && row.subjectId === cohort.id), periodStartDate: cohort.cohortStartDate, periodEndDate: cohort.monthOneEndDate }),
    campusStatusChanged: false as const,
  }));
  const quarters = quarterRows.map((quarter) => ({
    ...quarter,
    evaluation: evaluateRolloutGates({ definitions: gateCatalog("phase_quarter", quarter.phase), evidence: evidence.filter((row) => row.subjectType === "phase_quarter" && row.subjectId === quarter.id), periodStartDate: quarter.quarterStartDate, periodEndDate: quarter.quarterEndDate }),
    nationalLaunchCertified: false as const,
  }));
  return {
    summary: {
      campusCohorts: cohorts.length,
      campusEvidenceComplete: cohorts.filter((cohort) => cohort.evaluation.passed).length,
      phaseQuarters: quarters.length,
      phaseEvidenceComplete: quarters.filter((quarter) => quarter.evaluation.passed).length,
      systemSnapshotsIneligible: true,
      fullQuarterRequired: true,
      campusLaunchCertified: false,
      nationalLaunchCertified: false,
      boundary: "Approved external evidence can complete a register check; it never marks a campus live, certifies a national launch or proves the underlying external outcome by itself.",
    },
    campuses: campusRows,
    cohorts,
    quarters,
    evidence,
    events: eventRows.map(({ event, actorName }) => ({ ...event, actorName })),
  };
}
