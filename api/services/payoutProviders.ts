import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertLiveProviderExecutionAuthorized } from "./launchReadiness";

export type LiveProvider = "paystack" | "flutterwave";
export type ProviderPayoutInput = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  amountNetKobo: number;
  reference: string;
  narration: string;
};
export type ProviderPayoutReceipt = {
  provider: LiveProvider;
  providerRef: string;
  providerStatus: string;
  settlementEligible: false;
};

export function validateProviderPayoutInput(input: ProviderPayoutInput) {
  if (!/^\d{10}$/.test(input.accountNumber)) throw new Error("A transient ten-digit NUBAN is required");
  if (!/^[A-Za-z0-9-]{2,12}$/.test(input.bankCode)) throw new Error("A valid bank code is required");
  if (input.accountName.trim().length < 3) throw new Error("The verified account name is required");
  if (!Number.isSafeInteger(input.amountNetKobo) || input.amountNetKobo < 50_000) {
    throw new Error("Provider amount must be an integer-kobo value of at least ₦500");
  }
  if (!/^[a-z0-9_-]{16,50}$/.test(input.reference)) {
    throw new Error("Provider reference must be 16–50 lowercase letters, digits, dashes or underscores");
  }
  if (!input.narration.trim() || input.narration.length > 120) throw new Error("Narration must be 1–120 characters");
  return input;
}

function equalText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPaystackWebhook(rawBody: string, signature: string, secret: string) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  return equalText(expected, signature);
}

export function verifyFlutterwaveWebhook(signature: string, configuredHash: string) {
  return Boolean(signature && configuredHash && equalText(signature, configuredHash));
}

export class ProviderPayoutError extends Error {
  readonly rejected: boolean;

  constructor(message: string, rejected = false) {
    super(message);
    this.rejected = rejected;
  }
}

async function providerJson(response: Response): Promise<unknown> {
  if (!response.body) throw new ProviderPayoutError("Provider returned an empty response stream");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 256 * 1024) {
      await reader.cancel();
      throw new ProviderPayoutError("Provider response exceeded its bounded size");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // An ordinary 4xx rejection is safe to retry under a new merchant reference.
  // Timeouts, conflicts, rate limits, 5xx and malformed successes are ambiguous:
  // the provider may have accepted money movement, so dispatch must hold instead.
  if (!response.ok) {
    const rejected = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
    throw new ProviderPayoutError(`Provider request was rejected with HTTP ${response.status}`, rejected);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderPayoutError("Provider returned an invalid JSON response");
  }
}

const paystackRecipientSchema = z.object({
  status: z.literal(true),
  data: z.object({ recipient_code: z.string().min(5), active: z.boolean().optional() }),
});
const paystackTransferSchema = z.object({
  status: z.literal(true),
  data: z.object({
    reference: z.string(),
    transfer_code: z.string().min(5),
    status: z.string(),
  }),
});
const flutterwaveTransferSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    id: z.union([z.string(), z.number()]),
    reference: z.string(),
    status: z.string(),
  }),
});

export class PaystackPayoutAdapter {
  private readonly secretKey: string;
  private readonly request: typeof fetch;
  private readonly baseUrl: string;

  constructor(secretKey: string, request: typeof fetch = fetch, baseUrl = "https://api.paystack.co") {
    this.secretKey = secretKey;
    this.request = request;
    this.baseUrl = baseUrl;
  }

  async initiate(input: ProviderPayoutInput): Promise<ProviderPayoutReceipt> {
    validateProviderPayoutInput(input);
    if (!this.secretKey) throw new Error("Paystack server credential is not configured");
    const headers = { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" };
    const recipientResponse = await this.request(`${this.baseUrl}/transferrecipient`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "nuban",
        name: input.accountName.trim(),
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: "NGN",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const recipient = paystackRecipientSchema.parse(await providerJson(recipientResponse));
    if (recipient.data.active === false) throw new Error("Paystack recipient is not active");
    const transferResponse = await this.request(`${this.baseUrl}/transfer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "balance",
        amount: input.amountNetKobo,
        recipient: recipient.data.recipient_code,
        reference: input.reference,
        reason: input.narration.trim(),
        currency: "NGN",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const transfer = paystackTransferSchema.parse(await providerJson(transferResponse));
    if (transfer.data.reference !== input.reference) throw new Error("Paystack reference mismatch");
    return {
      provider: "paystack",
      // The attempt and webhook share the merchant-generated transfer reference.
      // Provider object ids are acceptance metadata, not settlement identifiers.
      providerRef: transfer.data.reference,
      providerStatus: transfer.data.status,
      settlementEligible: false,
    };
  }
}

export class FlutterwavePayoutAdapter {
  private readonly secretKey: string;
  private readonly request: typeof fetch;
  private readonly baseUrl: string;

  constructor(secretKey: string, request: typeof fetch = fetch, baseUrl = "https://api.flutterwave.com/v3") {
    this.secretKey = secretKey;
    this.request = request;
    this.baseUrl = baseUrl;
  }

  async initiate(input: ProviderPayoutInput): Promise<ProviderPayoutReceipt> {
    validateProviderPayoutInput(input);
    if (!this.secretKey) throw new Error("Flutterwave server credential is not configured");
    const response = await this.request(`${this.baseUrl}/transfers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        account_bank: input.bankCode,
        account_number: input.accountNumber,
        amount: input.amountNetKobo / 100,
        narration: input.narration.trim(),
        currency: "NGN",
        reference: input.reference,
        beneficiary_name: input.accountName.trim(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const transfer = flutterwaveTransferSchema.parse(await providerJson(response));
    if (transfer.data.reference !== input.reference) throw new Error("Flutterwave reference mismatch");
    return {
      provider: "flutterwave",
      providerRef: transfer.data.reference,
      providerStatus: transfer.data.status,
      settlementEligible: false,
    };
  }
}

/**
 * Live-only dispatch entry point. Acceptance returned here must remain
 * `processing`; verified webhooks alone can settle the payout.
 */
export async function initiateLiveProviderPayout(provider: LiveProvider, input: ProviderPayoutInput) {
  await assertLiveProviderExecutionAuthorized();
  if (provider === "paystack") {
    return new PaystackPayoutAdapter(process.env.PAYSTACK_SECRET_KEY || "").initiate(input);
  }
  return new FlutterwavePayoutAdapter(process.env.FLUTTERWAVE_SECRET_KEY || "").initiate(input);
}
