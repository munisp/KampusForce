import { describe, expect, it } from "vitest";
import { hashPhone, hmacSha256, normalizePhone, safeSignatureEqual, signedToken } from "./security";

describe("Nigerian phone normalization and privacy hashes", () => {
  it("normalizes local, international and formatted phone numbers", () => {
    expect(normalizePhone("0801 234 5678")).toBe("+2348012345678");
    expect(normalizePhone("2348012345678")).toBe("+2348012345678");
    expect(normalizePhone("+234 801 234 5678")).toBe("+2348012345678");
  });

  it("rejects invalid numbers", () => {
    expect(() => normalizePhone("12345")).toThrow(/valid Nigerian phone/);
  });

  it("produces stable hashes without exposing the source phone", () => {
    const hash = hashPhone("08012345678");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashPhone("+2348012345678"));
    expect(hash).not.toContain("08012345678");
    expect(hashPhone("08012345678")).not.toBe(hashPhone("08012345679"));
  });
});

describe("signed integration payloads", () => {
  it("verifies the correct raw-body HMAC and rejects tampering", () => {
    const body = JSON.stringify({ event_id: "evt_123", amount_kobo: 1000 });
    const signature = hmacSha256(body, "sandbox-secret");
    expect(safeSignatureEqual(`sha256=${signature}`, signature)).toBe(true);
    expect(safeSignatureEqual(hmacSha256(`${body} `, "sandbox-secret"), signature)).toBe(false);
    expect(safeSignatureEqual("not-a-signature", signature)).toBe(false);
  });

  it("signs attribution tokens with URL-safe payload and signature segments", () => {
    const token = signedToken("rep=1&product=2", "sandbox-secret");
    expect(token.split(".")).toHaveLength(2);
    expect(token).toBe(signedToken("rep=1&product=2", "sandbox-secret"));
    expect(token).not.toBe(signedToken("rep=1&product=3", "sandbox-secret"));
  });
});
