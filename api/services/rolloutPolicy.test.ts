import { describe, expect, it } from "vitest";
import { campusLaunchGates, evaluateRolloutGates, phaseExitGates, type RolloutEvidenceForEvaluation, type RolloutMetricUnit } from "./rolloutPolicy";

const period = { periodStartDate: "2026-07-01", periodEndDate: "2026-09-30" };
function evidence(metricKey: string, metricValue: number, unit: RolloutMetricUnit, overrides: Partial<RolloutEvidenceForEvaluation> = {}): RolloutEvidenceForEvaluation {
  return {
    id: 1,
    metricKey,
    sourceType: "external_evidence",
    realWorldAttested: true,
    state: "approved",
    metricValue: String(metricValue),
    unit,
    ...period,
    submittedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function evaluatePhase(evidenceRows: RolloutEvidenceForEvaluation[]) {
  return evaluateRolloutGates({ definitions: phaseExitGates[1], evidence: evidenceRows, ...period });
}

const passingPhaseOne = [
  evidence("activeRecruitRate", 50, "percent"),
  evidence("activationsPerActiveRep", 8, "ratio"),
  evidence("cacNaira", 1500, "naira"),
  evidence("payoutsWithin48hRate", 95, "percent"),
  evidence("disputeRate", 4.99, "percent"),
  evidence("campusCount", 5, "count"),
];

describe("rollout evidence policy", () => {
  it("never lets high-scoring system snapshots attain a real-world gate", () => {
    const rows = passingPhaseOne.map((row) => ({ ...row, sourceType: "system_snapshot" as const, realWorldAttested: false, state: "recorded" as const }));
    const result = evaluatePhase(rows);
    expect(result.passed).toBe(false);
    expect(result.passedCount).toBe(0);
    expect(result.checks.every((check) => check.status === "system_snapshot_ineligible")).toBe(true);
  });

  it("passes exact Phase 1 thresholds with approved full-quarter external evidence", () => {
    const result = evaluatePhase(passingPhaseOne);
    expect(result.passed).toBe(true);
    expect(result.passedCount).toBe(6);
    expect(result.realWorldOutcomeCertified).toBe(false);
  });

  it("requires complete quarter coverage even for approved external evidence", () => {
    const rows = passingPhaseOne.map((row) => ({ ...row, periodEndDate: "2026-09-29" }));
    const result = evaluatePhase(rows);
    expect(result.passed).toBe(false);
    expect(result.checks.every((check) => check.status === "incomplete_period_coverage")).toBe(true);
  });

  it("uses the latest external submission so rejection supersedes earlier approval", () => {
    const rows = [...passingPhaseOne, evidence("activeRecruitRate", 90, "percent", { id: 99, state: "rejected", submittedAt: "2026-10-02T00:00:00Z" })];
    const result = evaluatePhase(rows);
    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.key === "activeRecruitRate")?.status).toBe("latest_evidence_rejected");
  });

  it("keeps dispute rate strict and enforces the 3–5 lead-candidate range", () => {
    expect(evaluatePhase(passingPhaseOne.map((row) => row.metricKey === "disputeRate" ? { ...row, metricValue: "5" } : row)).checks.find((check) => check.key === "disputeRate")?.passed).toBe(false);
    const candidates = (value: number) => evaluateRolloutGates({ definitions: campusLaunchGates.filter((gate) => gate.key === "leadCandidates"), evidence: [evidence("leadCandidates", value, "count")], ...period });
    expect(candidates(3).passed).toBe(true);
    expect(candidates(5).passed).toBe(true);
    expect(candidates(2).passed).toBe(false);
    expect(candidates(6).passed).toBe(false);
  });

  it("rejects missing real-world attestation and unapproved submissions", () => {
    const unattested = evaluatePhase(passingPhaseOne.map((row) => ({ ...row, realWorldAttested: false })));
    expect(unattested.checks.every((check) => check.status === "real_world_attestation_missing")).toBe(true);
    const pending = evaluatePhase(passingPhaseOne.map((row) => ({ ...row, state: "submitted" as const })));
    expect(pending.checks.every((check) => check.status === "awaiting_independent_review")).toBe(true);
  });

  it("carries cumulative, payback, campus, vendor and EBITDA requirements into later phases", () => {
    expect(phaseExitGates[1].map((gate) => gate.key)).not.toContain("cumulativeActivations");
    expect(phaseExitGates[2].find((gate) => gate.key === "cumulativeActivations")?.threshold).toBe(136000);
    expect(phaseExitGates[2].find((gate) => gate.key === "paybackMonths")?.threshold).toBe(5.6);
    expect(phaseExitGates[3].find((gate) => gate.key === "cumulativeActivations")?.threshold).toBe(527000);
    expect(phaseExitGates[3].find((gate) => gate.key === "campusCount")?.threshold).toBe(35);
    expect(phaseExitGates[3].find((gate) => gate.key === "activeVendors")?.threshold).toBe(50);
    expect(phaseExitGates[3].find((gate) => gate.key === "ebitdaKobo")?.comparison).toBe("evidence");
  });

  it("fails a threshold or unit mismatch without treating the value as missing", () => {
    const below = evaluatePhase(passingPhaseOne.map((row) => row.metricKey === "campusCount" ? { ...row, metricValue: "4" } : row));
    expect(below.checks.find((check) => check.key === "campusCount")?.status).toBe("threshold_not_met");
    const wrongUnit = evaluatePhase(passingPhaseOne.map((row) => row.metricKey === "campusCount" ? { ...row, unit: "ratio" as const } : row));
    expect(wrongUnit.checks.find((check) => check.key === "campusCount")?.status).toBe("invalid_evidence_value");
  });
});
