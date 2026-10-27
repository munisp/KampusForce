import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlutterwavePayoutAdapter,
  PaystackPayoutAdapter,
  validateProviderPayoutInput,
  verifyFlutterwaveWebhook,
  verifyPaystackWebhook,
} from "./payoutProviders";
import { nairaMajorToKobo, providerEventKey } from "./providerWebhooks";

const input = {
  accountName: "Sandbox Student",
  accountNumber: "0123456789",
  bankCode: "058",
  amountNetKobo: 90_000,
  reference: "payout_test_123456",
  narration: "Sandbox adapter test",
};

afterEach(() => vi.restoreAllMocks());

describe("provider payout boundaries", () => {
  it("validates transient bank inputs and integer-kobo amounts", () => {
    expect(validateProviderPayoutInput(input)).toEqual(input);
    expect(() => validateProviderPayoutInput({ ...input, accountNumber: "123" })).toThrow(/NUBAN/);
    expect(() => validateProviderPayoutInput({ ...input, amountNetKobo: 49_999 })).toThrow(/₦500/);
    expect(() => validateProviderPayoutInput({ ...input, amountNetKobo: 90_000.5 })).toThrow(/integer-kobo/);
  });

  it("verifies Paystack HMAC-SHA512 over the exact raw body", () => {
    const raw = JSON.stringify({ event: "transfer.success", data: { reference: input.reference } });
    const signature = createHmac("sha512", "test-secret").update(raw).digest("hex");
    expect(verifyPaystackWebhook(raw, signature, "test-secret")).toBe(true);
    expect(verifyPaystackWebhook(`${raw} `, signature, "test-secret")).toBe(false);
    expect(verifyPaystackWebhook(raw, "bad", "test-secret")).toBe(false);
  });

  it("uses Flutterwave's configured verification hash", () => {
    expect(verifyFlutterwaveWebhook("configured-hash", "configured-hash")).toBe(true);
    expect(verifyFlutterwaveWebhook("other", "configured-hash")).toBe(false);
    expect(verifyFlutterwaveWebhook("", "configured-hash")).toBe(false);
  });

  it("keeps Paystack acceptance separate from settlement and uses the merchant reference", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url: String(url), body });
      if (String(url).endsWith("/transferrecipient")) {
        return new Response(JSON.stringify({ status: true, data: { recipient_code: "RCP_test", active: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: true, data: { reference: input.reference, transfer_code: "TRF_test", status: "pending" } }), { status: 200 });
    }) as typeof fetch;
    const receipt = await new PaystackPayoutAdapter("test-secret", request, "https://provider.invalid").initiate(input);
    expect(requests.map((row) => row.url)).toEqual(["https://provider.invalid/transferrecipient", "https://provider.invalid/transfer"]);
    expect(requests[1].body.amount).toBe(90_000);
    expect(receipt).toEqual({ provider: "paystack", providerRef: input.reference, providerStatus: "pending", settlementEligible: false });
    expect(JSON.stringify(receipt)).not.toContain(input.accountNumber);
  });

  it("converts Flutterwave kobo to NGN major units without marking acceptance settled", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.amount).toBe(900);
      expect(body.reference).toBe(input.reference);
      return new Response(JSON.stringify({ status: "success", data: { id: 12345, reference: input.reference, status: "NEW" } }), { status: 200 });
    }) as typeof fetch;
    const receipt = await new FlutterwavePayoutAdapter("test-secret", request, "https://provider.invalid/v3").initiate(input);
    expect(receipt.providerRef).toBe(input.reference);
    expect(receipt.settlementEligible).toBe(false);
  });

  it("rejects provider reference mismatches", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ status: "success", data: { id: 1, reference: "different_reference", status: "NEW" } }), { status: 200 })) as typeof fetch;
    await expect(new FlutterwavePayoutAdapter("test-secret", request, "https://provider.invalid/v3").initiate(input)).rejects.toThrow(/reference mismatch/);
  });
});

describe("provider webhook normalization", () => {
  it("parses NGN decimals exactly and rejects unsafe precision", () => {
    expect(nairaMajorToKobo("900")).toBe(90_000);
    expect(nairaMajorToKobo("900.05")).toBe(90_005);
    expect(nairaMajorToKobo(0.01)).toBe(1);
    expect(() => nairaMajorToKobo("1.001")).toThrow(/two places/);
    expect(() => nairaMajorToKobo("-1")).toThrow(/non-negative/);
  });

  it("deduplicates by provider and exact raw payload", () => {
    const raw = JSON.stringify({ event: "transfer.success" });
    expect(providerEventKey("paystack", raw)).toHaveLength(64);
    expect(providerEventKey("paystack", raw)).not.toBe(providerEventKey("flutterwave", raw));
    expect(providerEventKey("paystack", raw)).not.toBe(providerEventKey("paystack", `${raw} `));
  });
});
