import { describe, expect, it } from "vitest";
import { rateLimitSubjectHash, rateLimitWindowStart } from "./rateLimit";

describe("rate-limit policy", () => {
  it("uses fixed windows and stable hashed subjects", () => {
    const date = new Date("2026-10-28T09:04:59.999Z");
    expect(rateLimitWindowStart(date, 60).toISOString()).toBe("2026-10-28T09:04:00.000Z");
    expect(rateLimitWindowStart(date, 600).toISOString()).toBe("2026-10-28T09:00:00.000Z");
    const start = rateLimitWindowStart(date, 60);
    const hash = rateLimitSubjectHash("vendor_event", "vendor-secret-key", start);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("vendor-secret-key");
    expect(rateLimitSubjectHash("vendor_event", "vendor-secret-key", start)).toBe(hash);
    expect(rateLimitSubjectHash("vendor_event", "other-vendor", start)).not.toBe(hash);
    expect(rateLimitSubjectHash("vendor_event", "vendor-secret-key", new Date(start.getTime() + 60_000))).not.toBe(hash);
  });

  it("rejects invalid windows", () => {
    expect(() => rateLimitWindowStart(new Date(), 0)).toThrow("positive");
    expect(() => rateLimitWindowStart(new Date(), -1)).toThrow("positive");
  });
});
