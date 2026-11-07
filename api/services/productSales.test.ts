import { describe, expect, it } from "vitest";
import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { expectedSplit } from "./recordedSales";
import { detectImageType } from "./productCatalog";

describe("product sales money", () => {
  it("pays a flat commission per unit sold", () => {
    expect(calculateVendorCommissionKobo({ basis: "flat", flatAmountKobo: 50_000, pctBps: null }, null, 3)).toBe(150_000);
    expect(calculateVendorCommissionKobo({ basis: "flat", flatAmountKobo: 50_000, pctBps: null }, null)).toBe(50_000);
  });

  it("pays a percentage of the whole sale, whatever the quantity", () => {
    // 4 × ₦2,500 = ₦10,000 at 10% is ₦1,000, whether or not the quantity is passed.
    expect(calculateVendorCommissionKobo({ basis: "pct", pctBps: 1_000, flatAmountKobo: null }, 1_000_000, 4)).toBe(100_000);
  });

  it("rejects a zero or fractional quantity", () => {
    expect(() => calculateVendorCommissionKobo({ basis: "flat", flatAmountKobo: 50_000, pctBps: null }, null, 0)).toThrow();
    expect(() => calculateVendorCommissionKobo({ basis: "flat", flatAmountKobo: 50_000, pctBps: null }, null, 1.5)).toThrow();
  });

  it("splits a product sale 80/20 between the rep and KampusForce, adding up to what the vendor pays", () => {
    const split = expectedSplit({ basis: "flat", flatAmountKobo: 33_333, pctBps: null, triggerEvent: "sale" }, 99_999, 3)!;
    expect(split.vendorCommissionKobo).toBe(99_999);
    expect(split.repCommissionKobo + split.platformFeeKobo).toBe(split.vendorCommissionKobo);
    expect(split).toEqual(splitCommission(99_999));
  });

  it("ignores quantity for products that pay on a customer event", () => {
    expect(expectedSplit({ basis: "flat", flatAmountKobo: 100_000, pctBps: null, triggerEvent: "signup" }, null, 5)?.vendorCommissionKobo).toBe(100_000);
  });

  it("has no expected split when a percentage product has no amount yet", () => {
    expect(expectedSplit({ basis: "pct", pctBps: 2_000, flatAmountKobo: null, triggerEvent: "signup" }, null)).toBeNull();
    expect(expectedSplit(null, 100_000)).toBeNull();
  });
});

describe("product photos", () => {
  it("recognises JPEG, PNG and WebP from the bytes, and nothing else", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(detectImageType(Buffer.from("%PDF-1.7", "latin1"))).toBeNull();
    expect(detectImageType(Buffer.from("<svg onload=alert(1)>", "latin1"))).toBeNull();
  });
});
