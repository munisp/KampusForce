import type { VendorEventInput } from "./events";

export const VENDOR_PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const WEBHOOK_CREDENTIAL_GRACE_MS = 15 * 60 * 1000;
export const INGESTION_RETRY_BACKOFF_MS = [60_000, 5 * 60_000] as const;
export const INGESTION_MAX_RETRY_ATTEMPTS = 3;

export function redactVendorEventPayload(payload: VendorEventInput): VendorEventInput {
  return {
    ...payload,
    customer: {
      phone: "[redacted]",
      customer_ref: payload.customer.customer_ref ? "[hashed]" : undefined,
    },
  };
}

export function transientIngestionErrorCode(error: unknown): string | null {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = String(candidate?.code || candidate?.cause?.code || "").toUpperCase();
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(code)) return code;
  if (/^(08|40P01|40001|53300|55P03|57P01)/.test(code)) return code;
  return null;
}

export function ingestionRetryBackoff(attemptCount: number): number | null {
  if (attemptCount < 1 || attemptCount >= INGESTION_MAX_RETRY_ATTEMPTS) return null;
  return INGESTION_RETRY_BACKOFF_MS[attemptCount - 1];
}

export function credentialAcceptsAt(state: "active" | "retiring" | "revoked", expiresAt: Date | null, now: Date): boolean {
  if (state === "active") return true;
  return state === "retiring" && Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}
