import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  campusCohorts,
  campuses,
  deals,
  ledgerEntries,
  rolloutEvidence,
  rolloutEvidenceEvents,
  rolloutQuarters,
  users,
} from "../db/schema";
import {
  captureCampusCohortSnapshot,
  captureRolloutQuarterSnapshot,
  createCampusCohort,
  createRolloutQuarter,
  getRolloutReadiness,
  reviewRolloutEvidence,
  submitExternalRolloutEvidence,
} from "../api/services/rolloutReadiness";
import { campusLaunchGates, phaseExitGates } from "../api/services/rolloutPolicy";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const phone = () => `+23493${String(randomInt(10000000, 99999999))}`;

async function main() {
  const [submitter, reviewer, secondReviewer] = await db.insert(users).values([
    { phoneE164: phone(), name: "Phase Eleven Evidence Submitter", role: "ops" },
    { phoneE164: phone(), name: "Phase Eleven Independent Reviewer", role: "finance" },
    { phoneE164: phone(), name: "Phase Eleven Competing Reviewer", role: "admin" },
  ]).returning();
  const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
  const [financialDealsBefore, ledgerBefore] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);
  const cohort = await createCampusCohort({
    campusId: campus.id,
    label: `Control-test cohort ${suffix.slice(0, 10)}`,
    cohortStartDate: "2026-10-01",
    monthOneEndDate: "2026-10-31",
    actorUserId: submitter.id,
  });
  assert.equal(cohort.campusStatusChanged, false);
  await assert.rejects(() => createCampusCohort({ campusId: campus.id, label: `Invalid ${suffix}`, cohortStartDate: "2026-10-01", monthOneEndDate: "2026-11-30", actorUserId: submitter.id }), /one calendar month/);

  const existingQuarters = await db.select().from(rolloutQuarters);
  let quarterStart = "";
  let quarterEnd = "";
  for (let year = 2030; year < 2060 && !quarterStart; year += 1) {
    for (const month of [0, 3, 6, 9]) {
      const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      if (!existingQuarters.some((row) => row.phase === 3 && row.quarterStartDate === start)) {
        quarterStart = start;
        quarterEnd = new Date(Date.UTC(year, month + 3, 0)).toISOString().slice(0, 10);
        break;
      }
    }
  }
  const quarter = await createRolloutQuarter({ phase: 3, label: `Control-test national gate ${suffix.slice(0, 10)}`, quarterStartDate: quarterStart, quarterEndDate: quarterEnd, actorUserId: submitter.id });
  assert.equal(quarter.nationalLaunchCertified, false);
  await assert.rejects(() => createRolloutQuarter({ phase: 2, label: `Invalid ${suffix}`, quarterStartDate: "2026-07-01", quarterEndDate: "2026-09-29", actorUserId: submitter.id }), /complete calendar quarter/);

  const campusSnapshot = await captureCampusCohortSnapshot(cohort.id, submitter.id);
  const quarterSnapshot = await captureRolloutQuarterSnapshot(quarter.id, submitter.id);
  assert.equal(campusSnapshot.gateEligible, false);
  assert.equal(quarterSnapshot.gateEligible, false);
  let readiness = await getRolloutReadiness();
  let campusEvaluation = readiness.cohorts.find((row) => row.id === cohort.id)!.evaluation;
  let quarterEvaluation = readiness.quarters.find((row) => row.id === quarter.id)!.evaluation;
  assert.equal(campusEvaluation.passed, false);
  assert.equal(campusEvaluation.passedCount, 0);
  assert.equal(quarterEvaluation.passed, false);
  assert.equal(quarterEvaluation.passedCount, 0);
  assert.ok(campusEvaluation.checks.some((check) => check.status === "system_snapshot_ineligible"));
  assert.equal(readiness.summary.campusLaunchCertified, false);
  assert.equal(readiness.summary.nationalLaunchCertified, false);

  await assert.rejects(() => submitExternalRolloutEvidence({
    subjectType: "campus_cohort", subjectId: cohort.id, metricKey: "endorsement", metricValue: 1,
    periodStartDate: "2026-10-01", periodEndDate: "2026-10-31", evidenceReference: `external-${suffix}`,
    note: "A real-world attestation is mandatory for this control-test submission.", realWorldAttested: false, actorUserId: submitter.id,
  }), /explicit real-world attestation/);
  await assert.rejects(() => submitExternalRolloutEvidence({
    subjectType: "campus_cohort", subjectId: cohort.id, metricKey: "endorsement", metricValue: 1,
    periodStartDate: "2026-10-01", periodEndDate: "2026-10-31", evidenceReference: `sandbox-${suffix}`,
    note: "A sandbox reference must never become external rollout evidence.", realWorldAttested: true, actorUserId: submitter.id,
  }), /cannot be submitted as real-world evidence/);
  await assert.rejects(() => reviewRolloutEvidence({ evidenceId: campusSnapshot.evidenceIds[0], decision: "approved", reviewReference: `review-${suffix}`, note: "System snapshots must remain ineligible even after review attempts.", realWorldReviewAttested: true, actorUserId: reviewer.id }), /System snapshots are ineligible/);

  async function submitEvidence(subjectType: "campus_cohort" | "phase_quarter", subjectId: number, metricKey: string, metricValue: number, start: string, end: string) {
    const result = await submitExternalRolloutEvidence({
      subjectType, subjectId, metricKey, metricValue,
      periodStartDate: start, periodEndDate: end,
      evidenceReference: `control-test-${metricKey}-${suffix.slice(0, 12)}`,
      note: "Synthetic external-review acceptance attestation; tests control logic only and is not a real campus or national outcome.",
      realWorldAttested: true,
      actorUserId: submitter.id,
    });
    return result.evidenceId;
  }
  async function approve(evidenceId: number, actorUserId = reviewer.id) {
    return reviewRolloutEvidence({ evidenceId, decision: "approved", reviewReference: `independent-control-review-${suffix.slice(0, 12)}`, note: "Independent synthetic acceptance review; external outcomes remain uncertified.", realWorldReviewAttested: true, actorUserId });
  }

  const campusValues: Record<string, number> = { endorsement: 1, leadCandidates: 5, verifiedReps: 60, firstActivationRate: 30, monthOneActivations: 100, repNps: 40, realPayoutProof: 1 };
  const campusEvidence = new Map<string, number>();
  for (const definition of campusLaunchGates) {
    const id = await submitEvidence("campus_cohort", cohort.id, definition.key, campusValues[definition.key], "2026-10-01", "2026-10-31");
    campusEvidence.set(definition.key, id);
  }
  const firstEvidence = campusEvidence.get("endorsement")!;
  await assert.rejects(() => approve(firstEvidence, submitter.id), /Independent review/);
  const competing = await Promise.allSettled([approve(firstEvidence, reviewer.id), approve(firstEvidence, secondReviewer.id)]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competing.filter((result) => result.status === "rejected").length, 1);
  await assert.rejects(() => approve(firstEvidence, reviewer.id), /Only submitted external evidence/);
  for (const definition of campusLaunchGates.slice(1)) await approve(campusEvidence.get(definition.key)!);

  readiness = await getRolloutReadiness();
  campusEvaluation = readiness.cohorts.find((row) => row.id === cohort.id)!.evaluation;
  assert.equal(campusEvaluation.passed, true);
  assert.equal(campusEvaluation.passedCount, 7);
  assert.equal(campusEvaluation.realWorldOutcomeCertified, false);
  assert.equal((await db.select().from(campuses).where(eq(campuses.id, campus.id)))[0].status, campus.status);

  const incompleteId = await submitEvidence("campus_cohort", cohort.id, "repNps", 80, "2026-10-01", "2026-10-30");
  await approve(incompleteId);
  readiness = await getRolloutReadiness();
  assert.equal(readiness.cohorts.find((row) => row.id === cohort.id)!.evaluation.checks.find((check) => check.key === "repNps")?.status, "incomplete_period_coverage");
  const restoredNps = await submitEvidence("campus_cohort", cohort.id, "repNps", 40, "2026-10-01", "2026-10-31");
  await approve(restoredNps);

  const rejectedEndorsement = await submitEvidence("campus_cohort", cohort.id, "endorsement", 1, "2026-10-01", "2026-10-31");
  await reviewRolloutEvidence({ evidenceId: rejectedEndorsement, decision: "rejected", reviewReference: `rejection-${suffix.slice(0, 12)}`, note: "Synthetic rejection proves the latest external decision supersedes approval.", realWorldReviewAttested: true, actorUserId: reviewer.id });
  readiness = await getRolloutReadiness();
  assert.equal(readiness.cohorts.find((row) => row.id === cohort.id)!.evaluation.checks.find((check) => check.key === "endorsement")?.status, "latest_evidence_rejected");
  const restoredEndorsement = await submitEvidence("campus_cohort", cohort.id, "endorsement", 1, "2026-10-01", "2026-10-31");
  await approve(restoredEndorsement);

  const phaseValues: Record<string, number> = {
    activeRecruitRate: 60, activationsPerActiveRep: 14.4, cacNaira: 1000, payoutsWithin48hRate: 98,
    disputeRate: 2.99, campusCount: 35, cumulativeActivations: 527000, paybackMonths: 4.8,
    activeVendors: 50, ebitdaKobo: 125000000,
  };
  for (const definition of phaseExitGates[3]) {
    const id = await submitEvidence("phase_quarter", quarter.id, definition.key, phaseValues[definition.key], quarterStart, quarterEnd);
    await approve(id);
  }
  readiness = await getRolloutReadiness();
  quarterEvaluation = readiness.quarters.find((row) => row.id === quarter.id)!.evaluation;
  assert.equal(quarterEvaluation.passed, true);
  assert.equal(quarterEvaluation.passedCount, 10);
  assert.equal(quarterEvaluation.realWorldOutcomeCertified, false);
  assert.equal(readiness.summary.nationalLaunchCertified, false);
  assert.equal(readiness.summary.campusLaunchCertified, false);

  await assert.rejects(() => db.update(rolloutEvidenceEvents).set({ note: "must not mutate" }).where(eq(rolloutEvidenceEvents.evidenceId, firstEvidence)));
  await assert.rejects(() => db.update(campusCohorts).set({ label: "must not mutate" }).where(eq(campusCohorts.id, cohort.id)));
  await assert.rejects(() => db.delete(rolloutEvidence).where(eq(rolloutEvidence.id, firstEvidence)));
  const [financialDealsAfter, ledgerAfter] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);
  assert.deepEqual(financialDealsAfter, financialDealsBefore);
  assert.deepEqual(ledgerAfter, ledgerBefore);
  const history = await db.select().from(rolloutEvidenceEvents).where(eq(rolloutEvidenceEvents.evidenceId, firstEvidence));
  assert.equal(history.filter((event) => event.action === "external_evidence_approved").length, 1);

  console.log(JSON.stringify({
    status: "passed",
    mode: "sandbox_database_with_synthetic_external_review_attestations_only",
    realCampusOutcome: false,
    nationalLaunchCertified: false,
    campus: {
      systemSnapshotsIneligible: true,
      independentApproval: true,
      selfApprovalBlocked: true,
      competingReviewsAllowed: 1,
      incompleteMonthBlocked: true,
      latestRejectionSupersedes: true,
      campusStatusChanged: false,
      syntheticControlEvaluationPassed: campusEvaluation.passed,
    },
    phase: {
      fullQuarterRequired: true,
      requiredMetrics: quarterEvaluation.requiredCount,
      syntheticControlEvaluationPassed: quarterEvaluation.passed,
      realWorldOutcomeCertified: quarterEvaluation.realWorldOutcomeCertified,
    },
    appendOnlyHistory: true,
    financialRecordsUnchanged: true,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
