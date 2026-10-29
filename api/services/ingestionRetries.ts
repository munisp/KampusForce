import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { vendorEvents, vendorIngestionRetries, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { ingestVendorEvent, type IngestVendorEventOptions, type VendorEventInput } from "./events";
import { hashCustomerRef, hashPhone } from "./security";
import { resolvePromotionLink } from "./promotions";
import {
  INGESTION_MAX_RETRY_ATTEMPTS,
  ingestionRetryBackoff,
  redactVendorEventPayload,
  transientIngestionErrorCode,
} from "./ingestionPolicy";

export async function scheduleIngestionRetry(vendorKey: string, payload: VendorEventInput, errorCode = "TRANSIENT_INGESTION_FAILURE", options: IngestVendorEventOptions = {}) {
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, vendorKey)).limit(1);
  if (!vendor || vendor.status !== "active") throw new Error("Unknown or inactive vendor");
  const dedupeKey = `${vendor.id}:${payload.event_id}`;
  const customerPhoneHash = options.identifiers?.customerPhoneHash || hashPhone(payload.customer.phone);
  const customerRefHash = options.identifiers?.customerRefHash || hashCustomerRef(payload.customer.customer_ref || payload.customer.phone);
  const id = crypto.randomUUID();
  const nextRetryAt = new Date(Date.now() + (ingestionRetryBackoff(1) || 60_000));
  const rawPromotionToken = typeof payload.meta?.kf_token === "string" ? payload.meta.kf_token : null;
  const promotionLink = rawPromotionToken ? await resolvePromotionLink(rawPromotionToken) : null;
  await db.insert(vendorIngestionRetries).values({
    id,
    dedupeKey,
    vendorId: vendor.id,
    type: payload.type,
    payloadJson: redactVendorEventPayload(payload),
    customerPhoneHash,
    customerRefHash,
    promotionLinkId: options.promotionLinkId || promotionLink?.link.id || null,
    maxAttempts: INGESTION_MAX_RETRY_ATTEMPTS,
    nextRetryAt,
    lastErrorCode: errorCode.slice(0, 80),
  }).onConflictDoNothing().returning({ id: vendorIngestionRetries.id });
  const [retry] = await db.select().from(vendorIngestionRetries).where(eq(vendorIngestionRetries.dedupeKey, dedupeKey)).limit(1);
  return { retryId: retry.id, state: retry.state, nextRetryAt: retry.nextRetryAt };
}

export async function ingestWithDurableRetry(vendorKey: string, payload: VendorEventInput, options: IngestVendorEventOptions = {}) {
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, vendorKey)).limit(1);
  if (!vendor || vendor.status !== "active") throw new Error("Unknown or inactive vendor");
  const dedupeKey = `${vendor.id}:${payload.event_id}`;
  const [existingRetry] = await db.select().from(vendorIngestionRetries).where(eq(vendorIngestionRetries.dedupeKey, dedupeKey)).limit(1);
  if (existingRetry?.state === "retry_scheduled") {
    return { status: "retry_scheduled" as const, retry_id: existingRetry.id, next_retry_at: existingRetry.nextRetryAt };
  }
  if (existingRetry?.state === "dead_letter") {
    return { status: "dead_letter" as const, retry_id: existingRetry.id, reason: "Automatic ingestion retries exhausted; Operations review required" };
  }
  try {
    return await ingestVendorEvent(vendorKey, payload, options);
  } catch (error) {
    const errorCode = transientIngestionErrorCode(error);
    if (!errorCode) throw error;
    const retry = await scheduleIngestionRetry(vendorKey, payload, errorCode, options);
    return { status: "retry_scheduled" as const, retry_id: retry.retryId, next_retry_at: retry.nextRetryAt };
  }
}

type IngestFunction = typeof ingestVendorEvent;

async function processIngestionRetry(retryId: string, ingest: IngestFunction, now: Date) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [retry] = await tx.select().from(vendorIngestionRetries).where(eq(vendorIngestionRetries.id, retryId)).limit(1).for("update");
    if (!retry || retry.state !== "retry_scheduled" || retry.nextRetryAt.getTime() > now.getTime()) return "skipped" as const;
    const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, retry.vendorId)).limit(1);
    if (!vendor || vendor.status !== "active") {
      await tx.update(vendorIngestionRetries).set({ state: "dead_letter", lastErrorCode: "VENDOR_INACTIVE", updatedAt: now }).where(eq(vendorIngestionRetries.id, retry.id));
      return "dead_letter" as const;
    }
    const attemptCount = retry.attemptCount + 1;
    try {
      const result = await ingest(vendor.webhookKey, retry.payloadJson as VendorEventInput, {
        identifiers: { customerPhoneHash: retry.customerPhoneHash, customerRefHash: retry.customerRefHash },
        promotionLinkId: retry.promotionLinkId,
      });
      await tx.update(vendorIngestionRetries).set({
        attemptCount,
        state: "resolved",
        vendorEventId: result.kf_event_id,
        lastErrorCode: null,
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(vendorIngestionRetries.id, retry.id));
      return "resolved" as const;
    } catch (error) {
      const errorCode = transientIngestionErrorCode(error);
      const backoff = errorCode ? ingestionRetryBackoff(attemptCount) : null;
      await tx.update(vendorIngestionRetries).set({
        attemptCount,
        state: backoff ? "retry_scheduled" : "dead_letter",
        nextRetryAt: backoff ? new Date(now.getTime() + backoff) : retry.nextRetryAt,
        lastErrorCode: (errorCode || "PERMANENT_INGESTION_ERROR").slice(0, 80),
        updatedAt: now,
      }).where(eq(vendorIngestionRetries.id, retry.id));
      return backoff ? "retry_scheduled" as const : "dead_letter" as const;
    }
  });
}

export async function processDueIngestionRetries(now = new Date(), ingest: IngestFunction = ingestVendorEvent) {
  const due = await getDb().select({ id: vendorIngestionRetries.id }).from(vendorIngestionRetries)
    .where(and(eq(vendorIngestionRetries.state, "retry_scheduled"), lte(vendorIngestionRetries.nextRetryAt, now)))
    .orderBy(asc(vendorIngestionRetries.nextRetryAt)).limit(20);
  const results = { resolved: 0, retryScheduled: 0, deadLetter: 0, skipped: 0 };
  for (const retry of due) {
    const outcome = await processIngestionRetry(retry.id, ingest, now);
    if (outcome === "resolved") results.resolved += 1;
    else if (outcome === "retry_scheduled") results.retryScheduled += 1;
    else if (outcome === "dead_letter") results.deadLetter += 1;
    else results.skipped += 1;
  }
  return results;
}

export async function purgeExpiredVendorEventPayloads(now = new Date()) {
  const purged = await getDb().update(vendorEvents).set({
    payloadJson: { retention: "purged", payloadPurged: true },
    payloadPurgedAt: now,
  }).where(and(lte(vendorEvents.payloadRetainUntil, now), isNull(vendorEvents.payloadPurgedAt))).returning({ id: vendorEvents.id });
  return { purged: purged.length, dedupeRecordsRetained: true };
}
