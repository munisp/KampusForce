export type RolloutMetricUnit = "count" | "percent" | "naira" | "months" | "kobo" | "ratio";
export type RolloutSource = "system_snapshot" | "external_evidence";
export type RolloutEvidenceState = "recorded" | "submitted" | "approved" | "rejected";

export type RolloutGateDefinition = {
  key: string;
  label: string;
  unit: RolloutMetricUnit;
  comparison: "min" | "max" | "lt" | "range" | "evidence";
  threshold?: number;
  upperThreshold?: number;
  fullPeriod: boolean;
  requirement: string;
};

export type RolloutEvidenceForEvaluation = {
  id: number;
  metricKey: string;
  sourceType: RolloutSource;
  realWorldAttested: boolean;
  state: RolloutEvidenceState;
  metricValue: string | number;
  unit: RolloutMetricUnit;
  periodStartDate: string;
  periodEndDate: string;
  submittedAt: Date | string;
};

export const campusLaunchGates: RolloutGateDefinition[] = [
  { key: "endorsement", label: "Campus endorsement", unit: "count", comparison: "min", threshold: 1, fullPeriod: false, requirement: "A real, non-exclusive campus endorsement is independently reviewed." },
  { key: "leadCandidates", label: "Lead candidates", unit: "count", comparison: "range", threshold: 3, upperThreshold: 5, fullPeriod: false, requirement: "Between 3 and 5 real lead candidates are independently evidenced." },
  { key: "verifiedReps", label: "Verified representatives", unit: "count", comparison: "min", threshold: 60, fullPeriod: true, requirement: "At least 60 real verified representatives are evidenced for month one." },
  { key: "firstActivationRate", label: "Cohort first activation", unit: "percent", comparison: "min", threshold: 30, fullPeriod: true, requirement: "At least 30% of the real cohort completes a first activation." },
  { key: "monthOneActivations", label: "Month-one activations", unit: "count", comparison: "min", threshold: 100, fullPeriod: true, requirement: "At least 100 real month-one activations are evidenced." },
  { key: "repNps", label: "Representative NPS", unit: "ratio", comparison: "min", threshold: 40, fullPeriod: true, requirement: "A real representative NPS survey scores at least 40." },
  { key: "realPayoutProof", label: "Real payout proof", unit: "count", comparison: "min", threshold: 1, fullPeriod: true, requirement: "Authenticated provider/bank evidence proves at least one real payout." },
];

const common = {
  activeRecruitRate: (threshold: number): RolloutGateDefinition => ({ key: "activeRecruitRate", label: "Active recruits", unit: "percent", comparison: "min", threshold, fullPeriod: true, requirement: `At least ${threshold}% active recruits for the full quarter.` }),
  activationsPerActiveRep: (threshold: number): RolloutGateDefinition => ({ key: "activationsPerActiveRep", label: "Activations / active rep / month", unit: "ratio", comparison: "min", threshold, fullPeriod: true, requirement: `At least ${threshold} monthly activations per active representative for the full quarter.` }),
  cacNaira: (threshold: number): RolloutGateDefinition => ({ key: "cacNaira", label: "Customer acquisition cost", unit: "naira", comparison: "max", threshold, fullPeriod: true, requirement: `CAC no more than ₦${threshold.toLocaleString("en-NG")} for the full quarter.` }),
  payoutsWithin48hRate: (threshold: number): RolloutGateDefinition => ({ key: "payoutsWithin48hRate", label: "Payouts within 48 hours", unit: "percent", comparison: "min", threshold, fullPeriod: true, requirement: `At least ${threshold}% of eligible payouts complete within 48 hours for the full quarter.` }),
  disputeRate: (threshold: number): RolloutGateDefinition => ({ key: "disputeRate", label: "Dispute rate", unit: "percent", comparison: "lt", threshold, fullPeriod: true, requirement: `Dispute rate below ${threshold}% for the full quarter.` }),
  campuses: (threshold: number): RolloutGateDefinition => ({ key: "campusCount", label: "Real campuses", unit: "count", comparison: "min", threshold, fullPeriod: true, requirement: `At least ${threshold} real campuses are independently evidenced for the full quarter.` }),
};

export const phaseExitGates: Record<1 | 2 | 3, RolloutGateDefinition[]> = {
  1: [common.activeRecruitRate(50), common.activationsPerActiveRep(8), common.cacNaira(1500), common.payoutsWithin48hRate(95), common.disputeRate(5), common.campuses(5)],
  2: [common.activeRecruitRate(55), common.activationsPerActiveRep(14.4), common.cacNaira(1200), common.payoutsWithin48hRate(97), common.disputeRate(4), common.campuses(15),
    { key: "cumulativeActivations", label: "Cumulative activations", unit: "count", comparison: "min", threshold: 136000, fullPeriod: true, requirement: "At least 136,000 real cumulative activations with full-quarter evidence." },
    { key: "paybackMonths", label: "Payback", unit: "months", comparison: "max", threshold: 5.6, fullPeriod: true, requirement: "Payback no more than 5.6 months with full-quarter evidence." }],
  3: [common.activeRecruitRate(60), common.activationsPerActiveRep(14.4), common.cacNaira(1000), common.payoutsWithin48hRate(98), common.disputeRate(3), common.campuses(35),
    { key: "cumulativeActivations", label: "Cumulative activations", unit: "count", comparison: "min", threshold: 527000, fullPeriod: true, requirement: "At least 527,000 real cumulative activations with full-quarter evidence." },
    { key: "paybackMonths", label: "Payback", unit: "months", comparison: "max", threshold: 4.8, fullPeriod: true, requirement: "Payback no more than 4.8 months with full-quarter evidence." },
    { key: "activeVendors", label: "Active vendors", unit: "count", comparison: "min", threshold: 50, fullPeriod: true, requirement: "At least 50 real active vendors with full-quarter evidence." },
    { key: "ebitdaKobo", label: "Real EBITDA evidence", unit: "kobo", comparison: "evidence", fullPeriod: true, requirement: "Independently reviewed real EBITDA evidence; the numeric value is recorded without inferring a launch claim." }],
};

export function gateCatalog(subjectType: "campus_cohort" | "phase_quarter", phase?: number) {
  if (subjectType === "campus_cohort") return campusLaunchGates;
  if (!phase || ![1, 2, 3].includes(phase)) throw new Error("Rollout phase must be 1, 2 or 3");
  return phaseExitGates[phase as 1 | 2 | 3];
}

function coversPeriod(row: RolloutEvidenceForEvaluation, start: string, end: string) {
  return row.periodStartDate <= start && row.periodEndDate >= end;
}

export function evaluateRolloutGates(input: {
  definitions: RolloutGateDefinition[];
  evidence: RolloutEvidenceForEvaluation[];
  periodStartDate: string;
  periodEndDate: string;
}) {
  const checks = input.definitions.map((definition) => {
    const external = input.evidence
      .filter((row) => row.metricKey === definition.key && row.sourceType === "external_evidence")
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime() || b.id - a.id);
    const latest = external[0];
    const systemSnapshots = input.evidence.filter((row) => row.metricKey === definition.key && row.sourceType === "system_snapshot").length;
    if (!latest) return { ...definition, passed: false, status: systemSnapshots ? "system_snapshot_ineligible" : "missing_external_evidence", evidenceId: null, value: null, systemSnapshots };
    const value = Number(latest.metricValue);
    if (!latest.realWorldAttested) return { ...definition, passed: false, status: "real_world_attestation_missing", evidenceId: latest.id, value: Number.isFinite(value) ? value : null, systemSnapshots };
    if (latest.state !== "approved") return { ...definition, passed: false, status: latest.state === "rejected" ? "latest_evidence_rejected" : "awaiting_independent_review", evidenceId: latest.id, value: Number.isFinite(value) ? value : null, systemSnapshots };
    if (latest.unit !== definition.unit || !Number.isFinite(value)) return { ...definition, passed: false, status: "invalid_evidence_value", evidenceId: latest.id, value: null, systemSnapshots };
    if (definition.fullPeriod && !coversPeriod(latest, input.periodStartDate, input.periodEndDate)) {
      return { ...definition, passed: false, status: "incomplete_period_coverage", evidenceId: latest.id, value, systemSnapshots };
    }
    const passed = definition.comparison === "min" ? value >= definition.threshold!
      : definition.comparison === "max" ? value <= definition.threshold!
        : definition.comparison === "lt" ? value < definition.threshold!
          : definition.comparison === "range" ? value >= definition.threshold! && value <= definition.upperThreshold! : true;
    return { ...definition, passed, status: passed ? "approved_external_evidence" : "threshold_not_met", evidenceId: latest.id, value, systemSnapshots };
  });
  return {
    checks,
    passed: checks.every((check) => check.passed),
    passedCount: checks.filter((check) => check.passed).length,
    requiredCount: checks.length,
    realWorldOutcomeCertified: false as const,
  };
}
