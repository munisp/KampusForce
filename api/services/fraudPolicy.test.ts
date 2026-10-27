import { describe, expect, it } from "vitest";
import {
  activationCapExceeded,
  activationDayWindow,
  fraudReviewDueAt,
  isBlockingFraudHold,
  isFraudReviewOverdue,
} from "./fraudPolicy";

describe("fraud control policy", () => {
  it("uses Africa/Lagos calendar days with exact UTC boundaries", () => {
    const beforeMidnight = activationDayWindow(new Date("2026-10-27T22:59:59.000Z"));
    expect(beforeMidnight.localDay).toBe("2026-10-27");
    expect(beforeMidnight.windowStart.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(beforeMidnight.windowEnd.toISOString()).toBe("2026-10-27T23:00:00.000Z");
    const afterMidnight = activationDayWindow(new Date("2026-10-27T23:00:00.000Z"));
    expect(afterMidnight.localDay).toBe("2026-10-28");
    expect(afterMidnight.windowStart.toISOString()).toBe("2026-10-27T23:00:00.000Z");
    expect(afterMidnight.windowEnd.toISOString()).toBe("2026-10-28T23:00:00.000Z");
  });

  it("blocks only above the configured cap", () => {
    expect(activationCapExceeded(9, 10)).toBe(false);
    expect(activationCapExceeded(10, 10)).toBe(false);
    expect(activationCapExceeded(11, 10)).toBe(true);
    expect(activationCapExceeded(2, 1)).toBe(true);
  });

  it("sets a 24-hour initial and appeal review objective", () => {
    expect(fraudReviewDueAt(new Date("2026-10-27T12:00:00.000Z")).toISOString()).toBe("2026-10-28T12:00:00.000Z");
    expect(isFraudReviewOverdue({ state: "open", reviewDueAt: new Date("2026-10-27T12:00:00.000Z") }, new Date("2026-10-27T12:00:00.000Z"))).toBe(false);
    expect(isFraudReviewOverdue({ state: "open", reviewDueAt: new Date("2026-10-27T11:59:59.000Z") }, new Date("2026-10-27T12:00:00.000Z"))).toBe(true);
    expect(isFraudReviewOverdue({ state: "appeal_open", reviewDueAt: new Date("2026-10-27T11:00:00.000Z") }, new Date("2026-10-27T12:00:00.000Z"))).toBe(true);
    expect(isFraudReviewOverdue({ state: "released", reviewDueAt: new Date("2026-10-27T11:00:00.000Z") }, new Date("2026-10-27T12:00:00.000Z"))).toBe(false);
  });

  it("keeps active and upheld holds blocking while release is non-blocking", () => {
    expect(isBlockingFraudHold({ state: "active" })).toBe(true);
    expect(isBlockingFraudHold({ state: "upheld" })).toBe(true);
    expect(isBlockingFraudHold({ state: "released" })).toBe(false);
  });
});
