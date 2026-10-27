import { describe, expect, it } from "vitest";
import {
  credentialAcceptsAt,
  ingestionRetryBackoff,
  redactVendorEventPayload,
  transientIngestionErrorCode,
} from "./ingestionPolicy";

const payload = {
  event_id: "event-12345678",
  type: "funded" as const,
  occurred_at: new Date().toISOString(),
  customer: { phone: "+2348012345678", customer_ref: "customer-sensitive-ref" },
  product_ref: "savings-01",
};

describe("Phase 9 ingestion policy", () => {
  it("redacts customer identifiers while preserving processing terms", () => {
    const redacted = redactVendorEventPayload(payload);
    expect(redacted.customer.phone).toBe("[redacted]");
    expect(redacted.customer.customer_ref).toBe("[hashed]");
    expect(redacted.product_ref).toBe("savings-01");
    expect(JSON.stringify(redacted)).not.toContain(payload.customer.phone);
    expect(JSON.stringify(redacted)).not.toContain(payload.customer.customer_ref);
    expect(payload.customer.phone).toBe("+2348012345678");
  });

  it("classifies only transient infrastructure failures for retry", () => {
    expect(transientIngestionErrorCode({ code: "40P01" })).toBe("40P01");
    expect(transientIngestionErrorCode({ code: "ECONNRESET" })).toBe("ECONNRESET");
    expect(transientIngestionErrorCode(new Error("Invalid commission rule"))).toBeNull();
  });

  it("uses one and five minute backoff before the third retry is exhausted", () => {
    expect(ingestionRetryBackoff(1)).toBe(60_000);
    expect(ingestionRetryBackoff(2)).toBe(300_000);
    expect(ingestionRetryBackoff(3)).toBeNull();
  });

  it("accepts active and unexpired retiring credentials only", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    expect(credentialAcceptsAt("active", null, now)).toBe(true);
    expect(credentialAcceptsAt("retiring", new Date("2026-10-28T12:14:59.000Z"), now)).toBe(true);
    expect(credentialAcceptsAt("retiring", new Date("2026-10-28T12:00:00.000Z"), now)).toBe(false);
    expect(credentialAcceptsAt("revoked", null, now)).toBe(false);
  });
});
