import { describe, expect, it } from "vitest";
import { calculateVendorCommissionKobo, splitCommission, withholdingKobo } from "./money";

describe("commission money math", () => {
  it("uses integer kobo for flat rules and the 80/20 split", () => {
    const vendor = calculateVendorCommissionKobo({ basis: "flat", flatAmountKobo: 100_000, pctBps: null }, null);
    expect(splitCommission(vendor)).toEqual({ vendorCommissionKobo: 100_000, platformFeeKobo: 20_000, repCommissionKobo: 80_000 });
  });

  it("calculates percentage commissions from the verified transaction amount", () => {
    expect(calculateVendorCommissionKobo({ basis: "pct", pctBps: 500, flatAmountKobo: null }, 1_000_000)).toBe(50_000);
    expect(splitCommission(50_000)).toMatchObject({ repCommissionKobo: 40_000, platformFeeKobo: 10_000 });
  });

  it("keeps rep and platform allocations equal to funded commission when rounding", () => {
    const split = splitCommission(101);
    expect(split.repCommissionKobo + split.platformFeeKobo).toBe(101);
  });

  it("rejects missing percentage amounts and non-positive commissions", () => {
    expect(() => calculateVendorCommissionKobo({ basis: "pct", pctBps: 500, flatAmountKobo: null }, null)).toThrow(/positive event amount/);
    expect(() => splitCommission(0)).toThrow(/positive kobo/);
  });

  it("calculates withholding in kobo", () => {
    expect(withholdingKobo(80_000)).toBe(8_000);
    expect(withholdingKobo(50_001)).toBe(5_000);
  });
});
