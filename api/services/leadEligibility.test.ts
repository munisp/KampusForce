import { describe, expect, it } from "vitest";
import { leadDemotionReasons } from "./leadEligibility";

const eligible = {
  status: "active" as const,
  contractorAgreementSignedAt: new Date("2026-01-01T00:00:00Z"),
  topDecileEligible: true,
};

describe("Campus Lead demotion policy", () => {
  it("retains only active, signed, top-decile contractors", () => {
    expect(leadDemotionReasons(eligible)).toEqual([]);
  });

  it("demotes leads missing from active campus rankings", () => {
    expect(leadDemotionReasons(undefined)).toEqual(["not_active_in_campus_ranking"]);
  });

  it("collects every failed eligibility condition", () => {
    expect(leadDemotionReasons({
      status: "held",
      contractorAgreementSignedAt: null,
      topDecileEligible: false,
    })).toEqual(["rep_not_active", "outside_campus_top_decile", "contractor_agreement_missing"]);
  });
});
