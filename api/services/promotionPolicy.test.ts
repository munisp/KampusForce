import { describe, expect, it } from "vitest";
import { evaluatePromotionCapacity, evaluateStaffingProgress, scheduledPromotionTransition } from "./promotionPolicy";
import { redactVendorEventPayload } from "./ingestionPolicy";

describe("Phase 16 promotion capacity", () => {
  it("accepts a commission within both budget and uncommitted escrow", () => {
    expect(evaluatePromotionCapacity({ budgetCapKobo: 500_000, committedKobo: 100_000, escrowBalanceKobo: 800_000, pendingVendorCommitmentsKobo: 300_000, nextCommissionKobo: 100_000 })).toEqual({ allowed: true, reason: null, remainingBudgetKobo: 400_000, uncommittedEscrowKobo: 500_000 });
  });

  it("subtracts all vendor-pending commitments without subtracting confirmed deals twice", () => {
    const result = evaluatePromotionCapacity({ budgetCapKobo: 500_000, committedKobo: 200_000, escrowBalanceKobo: 250_000, pendingVendorCommitmentsKobo: 200_000, nextCommissionKobo: 100_000 });
    expect(result).toMatchObject({ allowed: false, reason: "escrow_depleted", remainingBudgetKobo: 300_000, uncommittedEscrowKobo: 50_000 });
  });

  it("fails closed at the promotion budget cap without changing history", () => {
    expect(evaluatePromotionCapacity({ budgetCapKobo: 100_000, committedKobo: 100_000, escrowBalanceKobo: 900_000, pendingVendorCommitmentsKobo: 0, nextCommissionKobo: 1 })).toMatchObject({ allowed: false, reason: "budget_cap", remainingBudgetKobo: 0 });
  });
});

describe("Phase 16 staffing and scheduling", () => {
  const startsAt = new Date("2026-10-01T00:00:00Z");
  const endsAt = new Date("2026-10-11T00:00:00Z");

  it("distinguishes recruitment progress from elapsed time", () => {
    expect(evaluateStaffingProgress({ target: 10, activated: 2, startsAt, endsAt, now: new Date("2026-10-09T00:00:00Z"), warningPct: 80 })).toEqual({ progressPct: 20, elapsedPct: 80, targetMet: false, atRisk: true });
  });

  it("stops new invitations at target while preserving existing onboarding", () => {
    expect(evaluateStaffingProgress({ target: 2, activated: 2, startsAt, endsAt, now: new Date("2026-10-03T00:00:00Z") })).toMatchObject({ targetMet: true, atRisk: false, progressPct: 100 });
  });

  it("starts only approved or scheduled promotions inside their window", () => {
    expect(scheduledPromotionTransition({ state: "approved", startsAt, endsAt, now: new Date("2026-10-02T00:00:00Z") })).toBe("promotion.started");
    expect(scheduledPromotionTransition({ state: "draft", startsAt, endsAt, now: new Date("2026-10-02T00:00:00Z") })).toBeNull();
    expect(scheduledPromotionTransition({ state: "active", startsAt, endsAt, now: new Date("2026-10-12T00:00:00Z") })).toBe("promotion.ended");
  });
});

describe("Phase 16 token privacy", () => {
  it("removes raw promotion tokens and customer identifiers from persisted webhook payloads", () => {
    const redacted = redactVendorEventPayload({ event_id: "evt-1", type: "funded", occurred_at: new Date().toISOString(), customer: { phone: "+2348000000000", customer_ref: "raw-customer" }, product_ref: "savings-01", meta: { kf_token: "raw-signed-promotion-token", vendor_note: "bounded" } });
    expect(JSON.stringify(redacted)).not.toContain("raw-signed-promotion-token");
    expect(JSON.stringify(redacted)).not.toContain("+2348000000000");
    expect(JSON.stringify(redacted)).not.toContain("raw-customer");
    expect(redacted.meta).toEqual({ vendor_note: "bounded" });
  });
});
