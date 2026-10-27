import { describe, expect, it } from "vitest";
import { incidentSeverityForSource, monitoringSlotKey } from "./incidentPolicy";

describe("operational incident policy", () => {
  it("assigns financial and worker failures critical severity", () => {
    expect(incidentSeverityForSource("job")).toBe("critical");
    expect(incidentSeverityForSource("payout")).toBe("critical");
    expect(incidentSeverityForSource("reconciliation")).toBe("critical");
    expect(incidentSeverityForSource("event_quarantine")).toBe("warning");
    expect(incidentSeverityForSource("support_sla")).toBe("warning");
  });

  it("deduplicates scheduled monitoring into five-minute slots", () => {
    expect(monitoringSlotKey(new Date("2026-10-28T08:02:59.999Z"))).toBe("2026-10-28T08:00");
    expect(monitoringSlotKey(new Date("2026-10-28T08:04:59.999Z"))).toBe("2026-10-28T08:00");
    expect(monitoringSlotKey(new Date("2026-10-28T08:05:00.000Z"))).toBe("2026-10-28T08:05");
  });
});
