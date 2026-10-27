import { describe, expect, it } from "vitest";
import { isSlaBreached, qualityScoreFromCsat, supportSlaDue } from "./supportPolicy";

describe("support SLA and quality scoring", () => {
  it("uses each vendor's SLA in whole hours", () => {
    const opened = new Date("2026-10-27T08:00:00.000Z");
    expect(supportSlaDue(24, opened).toISOString()).toBe("2026-10-28T08:00:00.000Z");
    expect(() => supportSlaDue(0, opened)).toThrow(/between 1 and 168/);
  });

  it("breaches only unresolved vendor or operations queues", () => {
    const due = new Date("2026-10-27T08:00:00.000Z");
    const now = new Date("2026-10-28T09:00:00.000Z");
    expect(isSlaBreached({ state: "vendor_queue", slaDueAt: due }, now)).toBe(true);
    expect(isSlaBreached({ state: "rep_triage", slaDueAt: due }, now)).toBe(false);
    expect(isSlaBreached({ state: "resolved", slaDueAt: due }, now)).toBe(false);
  });

  it("converts average CSAT to a 0–100 quality score and handles no ratings", () => {
    expect(qualityScoreFromCsat([])).toBe(100);
    expect(qualityScoreFromCsat([5, 4, 5])).toBe(93);
    expect(qualityScoreFromCsat([1])).toBe(20);
    expect(() => qualityScoreFromCsat([6])).toThrow(/1 to 5/);
  });
});
