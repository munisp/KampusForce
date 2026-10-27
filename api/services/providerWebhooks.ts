import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, payoutAttempts, providerWebhookEvents } from "@db/schema";
import { getDb } from "../queries/connection";
import { recordVerifiedProviderPayoutOutcome } from "./ledger";
import {
  verifyFlutterwaveWebhook,
  verifyPaystackWebhook,
  type LiveProvider,
} from "./payoutProviders";

export class ProviderWebhookError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 503 = 400) {
    super(message);
  }
}

const paystackEventSchema = z.object({
  event: z.string().min(1).max(80),
  data: z.object({
    id: z.union([z.string(), z.number()]).optional(),
    reference: z.string().max(100).optional(),
    status: z.string().max(60).optional(),
    amount: z.number().int().nonnegative().optional(),
    reason: z.string().max(300).optional(),
  }).passthrough(),
}).passthrough();

const flutterwaveEventSchema = z.object({
  event: z.string().min(1).max(80),
  data: z.object({
    id: z.union([z.string(), z.number()]).optional(),
    reference: z.string().max(100).optional(),
    status: z.string().max(60).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    complete_message: z.string().max(300).optional(),
  }).passthrough(),
}).passthrough();

export function providerEventKey(provider: LiveProvider, rawBody: string) {
  return createHash("sha256").update(`${provider}:${rawBody}`, "utf8").digest("hex");
}

/** Convert an NGN major-unit decimal to kobo without binary floating-point drift. */
export function nairaMajorToKobo(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Provider amount must be a non-negative NGN decimal with at most two places");
  const [major, fraction = ""] = text.split(".");
  const kobo = Number(major) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(kobo)) throw new Error("Provider amount exceeds the safe integer-kobo range");
  return kobo;
}

function externalEventId(provider: LiveProvider, data: { id?: string | number; reference?: string }, eventKey: string) {
  return String(data.id || data.reference || `${provider}:${eventKey.slice(0, 20)}`).slice(0, 160);
}

function failureCode(value: unknown, fallback: string) {
  const normalized = (typeof value === "string" && value.trim() ? value : fallback).toLowerCase().replace(/[^a-z0-9_ -]+/g, "").trim().replace(/[ -]+/g, "_");
  return normalized.slice(0, 120) || fallback;
}

async function insertEvent(input: {
  id: string;
  provider: LiveProvider;
  eventKey: string;
  eventType: string;
  payoutId?: number;
  payload: Record<string, unknown>;
  signatureVerified: boolean;
  state: "processed" | "ignored" | "quarantined";
  quarantineReason?: string;
}) {
  try {
    await getDb().insert(providerWebhookEvents).values({
      id: input.id,
      provider: input.provider,
      eventKey: input.eventKey,
      eventType: input.eventType.slice(0, 80),
      payoutId: input.payoutId || null,
      payloadJson: input.payload,
      signatureVerified: input.signatureVerified,
      state: input.state,
      quarantineReason: input.quarantineReason?.slice(0, 300) || null,
      processedAt: input.state === "ignored" ? null : new Date(),
    });
    return null;
  } catch (error) {
    // A concurrent delivery can win the unique event-key insert. Read back the
    // durable receipt rather than executing its financial outcome a second time.
    const [existing] = await getDb().select().from(providerWebhookEvents).where(eq(providerWebhookEvents.eventKey, input.eventKey)).limit(1);
    if (existing) return existing;
    throw error;
  }
}

async function finishEvent(id: string, state: "processed" | "ignored" | "quarantined", reason?: string, payoutId?: number) {
  await getDb().update(providerWebhookEvents).set({
    state,
    payoutId: payoutId || null,
    quarantineReason: reason?.slice(0, 300) || null,
    processedAt: state === "ignored" ? null : new Date(),
  }).where(eq(providerWebhookEvents.id, id));
}

/**
 * Verifies, deduplicates and sanitizes provider callbacks. Only exact matches to
 * an initiated attempt can enter the shared settlement path. Reversals and all
 * reference/amount ambiguities are quarantined and never infer a paid transfer.
 */
export async function processProviderWebhook(input: {
  provider: LiveProvider;
  rawBody: string;
  signature: string;
}) {
  const { provider, rawBody } = input;
  const eventKey = providerEventKey(provider, rawBody);
  const id = crypto.randomUUID();
  const secret = provider === "paystack" ? process.env.PAYSTACK_SECRET_KEY || "" : process.env.FLUTTERWAVE_WEBHOOK_HASH || "";
  const verified = provider === "paystack"
    ? verifyPaystackWebhook(rawBody, input.signature, secret)
    : verifyFlutterwaveWebhook(input.signature, secret);
  if (!verified) {
    await insertEvent({
      id,
      provider,
      // A rejected delivery must not poison dedupe for a later correctly signed
      // delivery of the same provider payload.
      eventKey: createHash("sha256").update(`${provider}:${rawBody}:unverified:${input.signature}`, "utf8").digest("hex"),
      eventType: "unverified",
      payload: {},
      signatureVerified: false,
      state: "quarantined",
      quarantineReason: "Provider signature verification failed",
    });
    throw new ProviderWebhookError("Provider signature verification failed", 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    await insertEvent({
      id, provider, eventKey, eventType: "malformed_json", payload: {}, signatureVerified: true,
      state: "quarantined", quarantineReason: "Signed payload is not valid JSON",
    });
    throw new ProviderWebhookError("Malformed provider JSON payload", 400);
  }
  const parsed = provider === "paystack" ? paystackEventSchema.safeParse(json) : flutterwaveEventSchema.safeParse(json);
  if (!parsed.success) {
    await insertEvent({
      id, provider, eventKey, eventType: "invalid_payload", payload: {}, signatureVerified: true,
      state: "quarantined", quarantineReason: "Signed provider payload does not match the expected transfer envelope",
    });
    throw new ProviderWebhookError("Invalid provider transfer payload", 400);
  }

  const event = parsed.data;
  const data = event.data;
  const reference = data.reference || "";
  const providerEventId = externalEventId(provider, data, eventKey);
  const sanitized: Record<string, unknown> = {
    providerEventId,
    reference: reference || null,
    providerStatus: data.status || null,
    amount: data.amount ?? null,
    boundary: "sanitized_transfer_metadata_only",
  };
  const existing = await insertEvent({
    id, provider, eventKey, eventType: event.event, payoutId: undefined,
    payload: sanitized, signatureVerified: true, state: "ignored",
  });
  if (existing) return { status: "duplicate" as const, state: existing.state, payoutId: existing.payoutId };

  let outcome: "success" | "failure" | "reversed" | "ignored";
  if (provider === "paystack") {
    outcome = event.event === "transfer.success" ? "success"
      : event.event === "transfer.failed" ? "failure"
        : event.event === "transfer.reversed" ? "reversed" : "ignored";
  } else {
    const status = (data.status || "").toUpperCase();
    outcome = event.event === "transfer.reversed" || status === "REVERSED" ? "reversed"
      : event.event === "transfer.completed" && status === "SUCCESSFUL" ? "success"
        : event.event === "transfer.completed" && ["FAILED", "CANCELLED"].includes(status) ? "failure" : "ignored";
  }
  if (outcome === "ignored") {
    await finishEvent(id, "ignored", "Signed event is not a terminal payout outcome");
    return { status: "ignored" as const, reason: "not_a_terminal_payout_outcome" };
  }
  if (outcome === "reversed") {
    await finishEvent(id, "quarantined", "Provider reversal requires Finance investigation; no ledger outcome inferred");
    return { status: "quarantined" as const, reason: "provider_reversal" };
  }
  if (!reference) {
    await finishEvent(id, "quarantined", "Terminal provider outcome has no transfer reference");
    return { status: "quarantined" as const, reason: "missing_provider_reference" };
  }

  const [attempt] = await getDb().select().from(payoutAttempts)
    .where(and(eq(payoutAttempts.provider, provider), eq(payoutAttempts.providerRef, reference))).limit(1);
  if (!attempt) {
    await finishEvent(id, "quarantined", "Provider reference does not match an initiated payout attempt");
    return { status: "quarantined" as const, reason: "unknown_provider_reference" };
  }

  let amountNetKobo: number;
  try {
    if (data.amount === undefined) throw new Error("Terminal provider outcome has no amount");
    amountNetKobo = provider === "paystack" ? Number(data.amount) : nairaMajorToKobo(data.amount);
    if (!Number.isSafeInteger(amountNetKobo) || amountNetKobo < 0) throw new Error("Invalid provider amount");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid provider amount";
    await finishEvent(id, "quarantined", reason, attempt.payoutId);
    return { status: "quarantined" as const, reason: "invalid_provider_amount", payoutId: attempt.payoutId };
  }

  try {
    const result = await recordVerifiedProviderPayoutOutcome({
      payoutId: attempt.payoutId,
      outcome,
      provider,
      providerRef: reference,
      providerEventId,
      amountNetKobo,
      failureCode: outcome === "failure"
        ? failureCode(provider === "paystack" ? data.reason : data.complete_message, "provider_failed")
        : undefined,
    });
    await finishEvent(id, "processed", undefined, attempt.payoutId);
    await getDb().insert(auditLogs).values({
      actorUserId: null,
      action: "provider_webhook.verified_outcome",
      entityType: "payout",
      entityId: String(attempt.payoutId),
      metadataJson: { provider, providerEventId, eventKey, outcome, amountNetKobo, sanitizedPayload: true },
    });
    return { status: "processed" as const, payoutId: attempt.payoutId, outcome: result.status };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Verified provider outcome could not be recorded";
    await finishEvent(id, "quarantined", reason, attempt.payoutId);
    return { status: "quarantined" as const, reason: "outcome_rejected", payoutId: attempt.payoutId };
  }
}
