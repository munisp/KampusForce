import { describe, expect, it } from "vitest";
import {
  assessReconciliation,
  dailyPayoutSlotKey,
  isDailyPayoutWindow,
  MAX_PAYOUT_ATTEMPTS,
  payoutProviderForAttempt,
  RECONCILIATION_TOLERANCE_KOBO,
  retryDelayMinutes,
} from "./payoutPolicy";

describe("payout scheduling and retry policy", () => {
  it("uses the 09:00 WAT window and a stable daily slot", () => {
    expect(isDailyPayoutWindow(new Date("2026-10-28T07:59:59.000Z"))).toBe(false);
    expect(isDailyPayoutWindow(new Date("2026-10-28T08:00:00.000Z"))).toBe(true);
    expect(isDailyPayoutWindow(new Date("2026-10-28T08:59:59.000Z"))).toBe(true);
    expect(isDailyPayoutWindow(new Date("2026-10-28T09:00:00.000Z"))).toBe(false);
    expect(dailyPayoutSlotKey(new Date("2026-10-28T08:00:00.000Z"))).toBe("2026-10-28-09:00-WAT");
  });

  it("retries three times with a sandbox fallback on the final attempt", () => {
    expect(MAX_PAYOUT_ATTEMPTS).toBe(3);
    expect(payoutProviderForAttempt(1)).toBe("paystack_sandbox");
    expect(payoutProviderForAttempt(2)).toBe("paystack_sandbox");
    expect(payoutProviderForAttempt(3)).toBe("flutterwave_sandbox");
    expect([retryDelayMinutes(1), retryDelayMinutes(2), retryDelayMinutes(3)]).toEqual([1, 5, 0]);
    expect(() => payoutProviderForAttempt(4)).toThrow();
  });
});

describe("three-way reconciliation policy", () => {
  it("requires complete evidence before comparing amounts", () => {
    expect(assessReconciliation({ complete: false, ledgerKobo: 10, providerKobo: 0, bankKobo: 0 }).state).toBe("pending");
  });

  it("matches exact amounts and applies the ₦1,000 batch threshold", () => {
    expect(assessReconciliation({ complete: true, ledgerKobo: 1000000, providerKobo: 1000000, bankKobo: 1000000 })).toEqual({ state: "matched", varianceKobo: 0 });
    expect(assessReconciliation({ complete: true, ledgerKobo: 1000000, providerKobo: 1000000, bankKobo: 1000000 + RECONCILIATION_TOLERANCE_KOBO }).state).toBe("within_tolerance");
    expect(assessReconciliation({ complete: true, ledgerKobo: 1000000, providerKobo: 1000000, bankKobo: 1000000 + RECONCILIATION_TOLERANCE_KOBO + 1 })).toEqual({ state: "variance", varianceKobo: RECONCILIATION_TOLERANCE_KOBO + 1 });
  });
});
