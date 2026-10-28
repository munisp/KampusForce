import { describe, expect, it } from "vitest";
import {
  buildOutreachDraft,
  caseNextAction,
  caseRisk,
  leaderboardPoints,
  opportunityStall,
  probabilityForStage,
  scoreOpportunity,
  scoreProductFit,
  validateCampaignWindow,
  weightedForecastKobo,
} from "./salesPolicy";

const now = new Date("2026-10-28T12:00:00.000Z");

describe("Phase 12 CRM policy", () => {
  it("maps stages to bounded planning probabilities", () => {
    expect(probabilityForStage("targeted")).toBe(10);
    expect(probabilityForStage("activation_pending")).toBe(75);
    expect(probabilityForStage("won")).toBe(100);
    expect(() => probabilityForStage("invented")).toThrow(/Unknown/);
  });

  it("detects overdue actions and seven-day quiet periods with reasons", () => {
    expect(opportunityStall({ stage: "qualified", lastActivityAt: new Date("2026-10-27T12:00:00.000Z"), nextActionAt: new Date("2026-10-28T11:00:00.000Z") }, now)).toMatchObject({ stalled: true });
    expect(opportunityStall({ stage: "contacted", lastActivityAt: new Date("2026-10-20T11:00:00.000Z") }, now)).toMatchObject({ stalled: true, quietDays: 8 });
    expect(opportunityStall({ stage: "won", lastActivityAt: new Date("2026-01-01T00:00:00.000Z") }, now).stalled).toBe(false);
  });

  it("weights only open forecasts and validates safe non-negative kobo", () => {
    expect(weightedForecastKobo([
      { expectedCommissionKobo: 100_000, probability: 50, stage: "qualified" },
      { expectedCommissionKobo: 100_000, probability: 100, stage: "won" },
    ])).toBe(50_000);
    expect(() => weightedForecastKobo([{ expectedCommissionKobo: -1, probability: 50, stage: "qualified" }])).toThrow(/Invalid/);
  });

  it("explains product and opportunity scores instead of claiming AI", () => {
    const product = scoreProductFit({ vendorQualityScore: 90, campusActivations: 2, repCategoryActivations: 1, requiredTrainingCompleted: true, alreadyRecommended: false });
    expect(product.score).toBeGreaterThan(50);
    expect(product.reasons.join(" ")).toMatch(/verified campus activation/);
    const opportunity = scoreOpportunity({ stage: "qualified", productFitScore: product.score, hasConsentedAttribution: true, activityCount: 2, nextActionAt: new Date("2026-10-29T12:00:00.000Z") }, now);
    expect(opportunity.score).toBeLessThanOrEqual(100);
    expect(opportunity.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it("drafts contextual outreach with human-only delivery language", () => {
    const result = buildOutreachDraft({ alias: "Study lead", productName: "LearnLoop", stage: "qualified", lastActivityBody: "Requested course details", nextActionAt: now });
    expect(result.body).toContain("Study lead");
    expect(result.body).toContain("vendor’s own flow");
    expect(result.rationale).toContain("No message is sent automatically");
  });
});

describe("Phase 12 case, campaign and leaderboard policy", () => {
  it("prioritizes overdue first response, SLA and missing ownership", () => {
    const risk = caseRisk({ priority: "urgent", state: "vendor_queue", slaDueAt: new Date("2026-10-28T11:00:00.000Z"), firstResponseDueAt: new Date("2026-10-28T10:00:00.000Z") }, now);
    expect(risk.score).toBe(100);
    expect(risk.reasons.join(" ")).toMatch(/First-response/);
    expect(caseNextAction({ state: "vendor_queue", assigneeUserId: null }, now)).toMatch(/Assign a named owner/);
  });

  it("limits snoozed-case risk while retaining the snooze reason", () => {
    const risk = caseRisk({ priority: "urgent", state: "ops_queue", slaDueAt: new Date("2026-10-28T11:00:00.000Z"), snoozedUntil: new Date("2026-10-29T12:00:00.000Z") }, now);
    expect(risk.score).toBeLessThanOrEqual(20);
    expect(risk.reasons.join(" ")).toMatch(/Snoozed/);
  });

  it("enforces campaign chronology and duration", () => {
    expect(() => validateCampaignWindow(new Date("2026-10-28T12:00:00.000Z"), new Date("2026-10-28T13:00:00.000Z"), now)).not.toThrow();
    expect(() => validateCampaignWindow(new Date("2026-10-28T13:00:00.000Z"), new Date("2026-10-28T12:00:00.000Z"), now)).toThrow(/after/);
    expect(() => validateCampaignWindow(new Date("2026-10-28T12:00:00.000Z"), new Date("2027-03-01T12:00:00.000Z"), now)).toThrow(/92 days/);
  });

  it("derives leaderboard points from verified, quality and learning inputs", () => {
    expect(leaderboardPoints({ confirmedActivations: 2, confirmedCommissionKobo: 50_000, qualityScore: 90, completedTraining: 3 })).toBe(289);
    expect(() => leaderboardPoints({ confirmedActivations: -1, confirmedCommissionKobo: 0, qualityScore: 100, completedTraining: 0 })).toThrow(/negative/);
  });
});
