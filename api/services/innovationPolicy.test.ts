import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  buildCaseCopilot,
  evaluateControlConditions,
  forecastAmountKobo,
  nextBestRelationshipAction,
  qualityReviewTotal,
  redactSensitiveText,
  riskAdaptiveTiming,
  simulatePromotionTwin,
  suppressSmallCohorts,
} from "./innovationPolicy";

describe("Phase 17 platform decision policy", () => {
  it("bounds a promotion twin by demand, budget and escrow without creating entitlement", () => {
    expect(simulatePromotionTwin({ representatives: 10, activationsPerRepresentative: 4, vendorCommissionKobo: 1_000, budgetCapKobo: 25_000, escrowKobo: 12_000, refundPct: 25 })).toMatchObject({
      projectedGrossActivations: 40,
      fundedActivations: 12,
      expectedNetActivations: 9,
      unfundedActivations: 28,
      committedBudgetKobo: 12_000,
      uncommittedBudgetKobo: 13_000,
      constrained: true,
      constraint: "budget_or_escrow",
      liveStateChanged: false,
      commissionEntitlementCreated: false,
    });
    expect(simulatePromotionTwin({ representatives: 0, activationsPerRepresentative: 0, vendorCommissionKobo: 0, budgetCapKobo: 0, escrowKobo: 0, refundPct: 0 }).fundedActivations).toBe(0);
    expect(() => simulatePromotionTwin({ representatives: -1, activationsPerRepresentative: 1, vendorCommissionKobo: 1, budgetCapKobo: 1, escrowKobo: 1, refundPct: 0 })).toThrow(/non-negative/);
  });

  it("evaluates only explicit scalar control conditions and explains every comparison", () => {
    const conditions = [{ field: "outcome.mismatches", operator: "gte", value: 1 }, { field: "state", operator: "in", value: "pending,disputed" }];
    expect(evaluateControlConditions(conditions, { outcome: { mismatches: 2 }, state: "pending" })).toMatchObject({ matched: true });
    expect(evaluateControlConditions(conditions, { outcome: { mismatches: 0 }, state: "pending" }).matched).toBe(false);
    expect(() => evaluateControlConditions([{ field: "outcome", operator: "eq", value: "x" }], { outcome: { nested: true } })).toThrow(/scalar/);
  });

  it("suppresses all small-cohort values rather than merely hiding a rate", () => {
    expect(suppressSmallCohorts([{ key: "a", cohort: 4, numerator: 3, denominator: 4 }, { key: "b", cohort: 5, numerator: 4, denominator: 5 }])).toEqual([
      { key: "a", cohort: 0, numerator: 0, denominator: 0, suppressed: true },
      { key: "b", cohort: 5, numerator: 4, denominator: 5, suppressed: false },
    ]);
    expect(() => suppressSmallCohorts([], 4)).toThrow(/at least five/);
  });

  it("caps risk and returns recommendations rather than financial actions", () => {
    expect(riskAdaptiveTiming({ openFraudCases: 1, criticalAssuranceCases: 1, outcomeMismatches: 1, priorChargebacks: 1, vendorCommissionKobo: 1_000_000 })).toMatchObject({ score: 100, recommendedReviewHours: 4, recommendedPayoutDelayHours: 72, automaticFinancialAction: false });
    expect(riskAdaptiveTiming({ openFraudCases: 0, criticalAssuranceCases: 0, outcomeMismatches: 0, priorChargebacks: 0, vendorCommissionKobo: 0 })).toMatchObject({ score: 0, recommendedPayoutDelayHours: 0 });
  });
});

describe("Phase 17 CRM decision policy", () => {
  const rows = [
    { expectedCommissionKobo: 100_000, probability: 50, stage: "qualified" },
    { expectedCommissionKobo: 80_000, probability: 75, stage: "activation_pending" },
    { expectedCommissionKobo: 50_000, probability: 10, stage: "targeted" },
    { expectedCommissionKobo: 999_000, probability: 100, stage: "won" },
  ];

  it("separates commit, best-case and pipeline planning scenarios", () => {
    expect(forecastAmountKobo(rows, "commit")).toBe(88_000);
    expect(forecastAmountKobo(rows, "pipeline")).toBe(115_000);
    expect(forecastAmountKobo(rows, "best")).toBe(155_250);
    expect(() => forecastAmountKobo([{ expectedCommissionKobo: -1, probability: 1, stage: "qualified" }], "pipeline")).toThrow(/non-negative/);
  });

  it("prioritizes overdue work, consent and verified vendor outcomes", () => {
    expect(nextBestRelationshipAction({ stage: "contacted", openTasks: 1, overdueTasks: 1, daysQuiet: 0, hasConsent: true }).actionType).toBe("complete_overdue_task");
    expect(nextBestRelationshipAction({ stage: "contacted", openTasks: 0, overdueTasks: 0, daysQuiet: 8, hasConsent: false }).actionType).toBe("refresh_purpose_consent");
    expect(nextBestRelationshipAction({ stage: "activation_pending", openTasks: 1, overdueTasks: 0, daysQuiet: 0, hasConsent: true }).actionType).toBe("verify_vendor_outcome");
  });
});

describe("Phase 17 case policy", () => {
  it("redacts national identifiers before phone patterns and keeps raw values out of copilot output", () => {
    const source = "NIN 12345678901; call +234 803 123 4567 or mail person@example.test";
    const redacted = redactSensitiveText(source);
    expect(redacted.text).not.toContain("12345678901");
    expect(redacted.text).not.toContain("person@example.test");
    expect(redacted.redactions).toContain("national_identifier:1");
    const copilot = buildCaseCopilot({ subject: "Activation case", description: source, state: "ops_queue", messages: [] });
    expect(copilot.summary).not.toContain("12345678901");
    expect(copilot.suggestedActions.join(" ")).toMatch(/do not alter commission state/i);
  });

  it("requires a complete independent quality rubric", () => {
    expect(qualityReviewTotal({ ownership: 20, evidence: 15, communication: 10, privacy: 20, resolution: 15 })).toBe(80);
    expect(() => qualityReviewTotal({ ownership: 20 })).toThrow(/evidence/);
    expect(() => qualityReviewTotal({ ownership: 20, evidence: 20, communication: 20, privacy: 20, resolution: 20, extra: 1 })).toThrow(/Unknown/);
  });

  it("handles Africa/Lagos business windows, exact closing boundaries and weekends", () => {
    const window = { businessDays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1020, timezoneOffsetMinutes: 60 };
    expect(addBusinessMinutes(new Date("2026-10-26T07:30:00.000Z"), 60, window).toISOString()).toBe("2026-10-26T08:30:00.000Z");
    expect(addBusinessMinutes(new Date("2026-10-26T15:00:00.000Z"), 60, window).toISOString()).toBe("2026-10-26T16:00:00.000Z");
    expect(addBusinessMinutes(new Date("2026-10-26T15:00:00.000Z"), 61, window).toISOString()).toBe("2026-10-27T07:01:00.000Z");
    expect(addBusinessMinutes(new Date("2026-10-31T10:00:00.000Z"), 0, window).toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(() => addBusinessMinutes(new Date(), 0, { startMinute: 600, endMinute: 600 })).toThrow(/Invalid/);
  });
});
