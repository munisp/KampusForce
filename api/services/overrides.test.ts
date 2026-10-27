import { describe, expect, it } from "vitest";
import { calculateLeadOverride, rankTopDecile } from "./overrides";

describe("campus lead overrides", () => {
  it("takes 5% of team rep commission entirely from platform margin", () => {
    expect(calculateLeadOverride(80_000, 20_000)).toEqual({ basisPoints: 500, teamCommissionKobo: 80_000, overrideKobo: 4_000, platformMarginKobo: 20_000, platformMarginAfterKobo: 16_000 });
  });

  it("never permits an override above platform margin", () => {
    expect(() => calculateLeadOverride(80_000, 3_000)).toThrow(/exceeds available platform margin/);
  });

  it("ranks at least one eligible rep per non-empty campus and scales to the top decile", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ repId: index + 1, campusId: 1, confirmedCommissionKobo: (20 - index) * 1000, activationCount: 20 - index }));
    const ranked = rankTopDecile(rows);
    expect(ranked[0]).toMatchObject({ repId: 1, rank: 1, topDecileEligible: true });
    expect(ranked.filter((row) => row.topDecileEligible)).toHaveLength(2);
    expect(rankTopDecile([rows[0]])[0].topDecileEligible).toBe(true);
  });
});
