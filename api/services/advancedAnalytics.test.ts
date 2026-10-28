import { describe, expect, it } from "vitest";
import { analyticsAnomalies, buildConversionCohorts } from "./advancedAnalytics";

describe("advanced analytics control findings", () => {
  it("prioritizes financial failures and reconciliation variance", () => {
    const findings = analyticsAnomalies({ quarantineRate: 8, pendingPostings: 4, failedPostings: 1, reconciliationVariances: 2, confirmedActivations: 0, processedEvents: 20 });
    expect(findings.map((finding) => finding.code)).toEqual(["event_quality", "financial_outbox_failed", "financial_outbox_backlog", "reconciliation_variance", "activation_conversion"]);
    expect(findings.find((finding) => finding.code === "financial_outbox_failed")?.severity).toBe("critical");
  });

  it("does not invent findings for a clean quiet window", () => {
    expect(analyticsAnomalies({ quarantineRate: 0, pendingPostings: 0, failedPostings: 0, reconciliationVariances: 0, confirmedActivations: 0, processedEvents: 0 })).toEqual([]);
  });
});

describe("activation conversion cohorts", () => {
  it("uses first confirmation history and a complete seven-day denominator", () => {
    const rows = [
      { dealId: 1, createdAt: "2026-01-05T09:00:00Z", firstConfirmedAt: "2026-01-10T08:59:00Z" },
      { dealId: 2, createdAt: "2026-01-06T09:00:00Z", firstConfirmedAt: "2026-01-14T09:01:00Z" },
      { dealId: 3, createdAt: "2026-01-07T09:00:00Z", firstConfirmedAt: null },
    ];
    expect(buildConversionCohorts(rows, new Date("2026-01-20T00:00:00Z"))).toEqual([
      { week: "2026-01-05", activations: 3, matureActivations: 3, confirmedWithin7Days: 1, conversionWithin7Days: 33.33 },
    ]);
  });

  it("excludes immature records from the conversion denominator without dropping them from cohort volume", () => {
    const [cohort] = buildConversionCohorts([{ dealId: 1, createdAt: "2026-01-08T09:00:00Z", firstConfirmedAt: null }], new Date("2026-01-10T00:00:00Z"));
    expect(cohort).toMatchObject({ activations: 1, matureActivations: 0, conversionWithin7Days: 0 });
  });
});
