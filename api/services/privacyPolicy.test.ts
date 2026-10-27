import { describe, expect, it } from "vitest";
import {
  breachTriageDueAt,
  canExportDsar,
  dsarDueAt,
  isBreachTriageOverdue,
  isDsarOverdue,
} from "./privacyPolicy";

describe("privacy deadlines and export gates", () => {
  it("sets exact 30-day DSAR and 72-hour breach deadlines", () => {
    const receivedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(dsarDueAt(receivedAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(breachTriageDueAt(receivedAt).toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("withholds evidence export until identity verification", () => {
    expect(canExportDsar("received")).toBe(false);
    expect(canExportDsar("identity_verified")).toBe(true);
    expect(canExportDsar("in_review")).toBe(true);
    expect(canExportDsar("fulfilled")).toBe(true);
    expect(canExportDsar("rejected")).toBe(false);
  });

  it("flags only unresolved overdue privacy work", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const past = new Date("2026-01-31T23:59:59.000Z");
    expect(isDsarOverdue({ state: "in_review", dueAt: past }, now)).toBe(true);
    expect(isDsarOverdue({ state: "fulfilled", dueAt: past }, now)).toBe(false);
    expect(isDsarOverdue({ state: "rejected", dueAt: past }, now)).toBe(false);
    expect(isBreachTriageOverdue({ state: "assessing", triageDueAt: past }, now)).toBe(true);
    expect(isBreachTriageOverdue({ state: "decision_recorded", triageDueAt: past }, now)).toBe(false);
    expect(isBreachTriageOverdue({ state: "closed", triageDueAt: past }, now)).toBe(false);
  });
});
