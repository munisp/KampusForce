import { describe, expect, it } from "vitest";
import { calculateRuleDryRun } from "./ruleMath";

const base = { triggerEvent: "funded" as const, recurrenceMonths: 1, confirmDays: 30, clawbackDays: 60 };

describe("vendor rule dry runs", () => {
  it("reuses the canonical flat commission split", () => {
    const result = calculateRuleDryRun({ ...base, basis: "flat", flatAmountKobo: 100_000 }, null);
    expect(result).toMatchObject({ vendorCommissionKobo: 100_000, repCommissionKobo: 80_000, platformFeeKobo: 20_000, pctBps: null });
  });

  it("calculates a percentage rule from the sample event amount", () => {
    const result = calculateRuleDryRun({ ...base, basis: "pct", pctBps: 750 }, 2_000_000);
    expect(result).toMatchObject({ vendorCommissionKobo: 150_000, repCommissionKobo: 120_000, platformFeeKobo: 30_000, flatAmountKobo: null });
  });

  it("clears fields from the inactive basis and rejects incomplete rules", () => {
    const result = calculateRuleDryRun({ ...base, basis: "flat", flatAmountKobo: 25_000, pctBps: 500 }, null);
    expect(result.pctBps).toBeNull();
    expect(() => calculateRuleDryRun({ ...base, basis: "pct", pctBps: 500 }, null)).toThrow(/positive event amount/);
    expect(() => calculateRuleDryRun({ ...base, basis: "flat", flatAmountKobo: 0 }, null)).toThrow(/valid amount/);
  });
});
