import { and, desc, eq, isNull } from "drizzle-orm";
import { attributionRecords, commissionRules, dealStateHistory, deals, products, vendorEvents, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { enforceActivationVelocity } from "./fraud";
import { reverseDeal } from "./ledger";
import { hashCustomerRef, hashPhone } from "./security";
import { redactVendorEventPayload, VENDOR_PAYLOAD_RETENTION_MS } from "./ingestionPolicy";

export type VendorEventInput = {
  event_id: string;
  type: "account_created" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "refund";
  occurred_at: string;
  customer: { phone: string; customer_ref?: string };
  product_ref: string;
  amount_kobo?: number;
  meta?: Record<string, unknown>;
};

export type IngestVendorEventOptions = {
  credentialId?: number | null;
  identifiers?: { customerPhoneHash: string; customerRefHash: string };
};

export async function ingestVendorEvent(vendorKey: string, payload: VendorEventInput, options: IngestVendorEventOptions = {}) {
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, vendorKey)).limit(1);
  if (!vendor || vendor.status !== "active") throw new Error("Unknown or inactive vendor");
  const dedupeKey = `${vendor.id}:${payload.event_id}`;
  const [duplicate] = await db.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, dedupeKey)).limit(1);
  if (duplicate) return { status: "duplicate" as const, kf_event_id: duplicate.id };
  const [product] = await db.select().from(products).where(and(eq(products.vendorRef, payload.product_ref), eq(products.vendorId, vendor.id))).limit(1);
  const phoneHash = options.identifiers?.customerPhoneHash || hashPhone(payload.customer.phone);
  const customerRefHash = options.identifiers?.customerRefHash || hashCustomerRef(payload.customer.customer_ref || payload.customer.phone);
  const eventId = crypto.randomUUID();
  const baseEvent = {
    id: eventId,
    vendorId: vendor.id,
    type: payload.type,
    customerRefHash,
    productId: product?.id || null,
    amountKobo: payload.amount_kobo || null,
    payloadJson: redactVendorEventPayload(payload),
    hmacOk: true,
    dedupeKey,
    webhookCredentialId: options.credentialId || null,
    payloadRetainUntil: new Date(Date.now() + VENDOR_PAYLOAD_RETENTION_MS),
  };
  if (!product) {
    await db.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "Unknown product_ref" });
    return { status: "quarantined" as const, kf_event_id: eventId, reason: "Unknown product_ref" };
  }
  if (payload.type === "refund") {
    const [deal] = await db.select().from(deals).where(and(eq(deals.customerPhoneHash, phoneHash), eq(deals.productId, product.id))).orderBy(desc(deals.createdAt)).limit(1);
    await db.insert(vendorEvents).values(baseEvent);
    if (!deal) return { status: "ignored" as const, kf_event_id: eventId, reason: "No matching deal to reverse" };
    const result = await reverseDeal(deal.id, `vendor:${vendor.id}:refund`);
    return { status: "processed" as const, kf_event_id: eventId, ...result };
  }

  return db.transaction(async (tx) => {
    // Serializing the vendor's ingestion transaction makes the dedupe recheck authoritative.
    await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendor.id)).limit(1).for("update");
    const [concurrentDuplicate] = await tx.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, dedupeKey)).limit(1);
    if (concurrentDuplicate) return { status: "duplicate" as const, kf_event_id: concurrentDuplicate.id };
    const [attribution] = await tx.select().from(attributionRecords).where(and(eq(attributionRecords.customerPhoneHash, phoneHash), eq(attributionRecords.vendorId, vendor.id), eq(attributionRecords.status, "active"))).limit(1);
    if (!attribution) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "No active first-touch attribution; eligible for 24h claim review" });
      return { status: "quarantined" as const, kf_event_id: eventId, reason: "No active attribution" };
    }
    const trigger = (payload.type === "account_created" ? "signup" : payload.type) as typeof commissionRules.$inferInsert.triggerEvent;
    const [rule] = await tx.select().from(commissionRules).where(and(eq(commissionRules.productId, product.id), eq(commissionRules.triggerEvent, trigger), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.version)).limit(1);
    if (!rule) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "ignored", quarantineReason: "Event does not trigger the active commission rule" });
      return { status: "ignored" as const, kf_event_id: eventId };
    }
    let commission: ReturnType<typeof splitCommission>;
    try {
      commission = splitCommission(calculateVendorCommissionKobo(rule, payload.amount_kobo || null));
    } catch (error) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: error instanceof Error ? error.message : "Commission calculation failed" });
      return { status: "quarantined" as const, kf_event_id: eventId };
    }
    const velocity = await enforceActivationVelocity(tx, {
      repId: attribution.repId,
      productId: product.id,
      triggerEvent: trigger,
      eventId,
      cap: rule.activationCapPerRepDay,
    });
    if (velocity.blocked) {
      await tx.insert(vendorEvents).values({
        ...baseEvent,
        status: "quarantined",
        quarantineReason: `Daily activation cap ${velocity.attemptCount}/${velocity.cap}; fraud case ${velocity.caseRef}`,
      });
      return {
        status: "quarantined" as const,
        kf_event_id: eventId,
        reason: "Daily activation cap exceeded; payout hold opened for Operations review",
        fraud_case_ref: velocity.caseRef,
        attempt_count: velocity.attemptCount,
        cap: velocity.cap,
      };
    }
    await tx.insert(vendorEvents).values(baseEvent);
    const [{ id: dealId }] = await tx.insert(deals).values({
      attributionId: attribution.id,
      productId: product.id,
      vendorId: vendor.id,
      repId: attribution.repId,
      commissionRuleId: rule.id,
      customerPhoneHash: phoneHash,
      triggerEvent: trigger,
      eventId,
      state: "pending",
      ...commission,
      confirmAt: new Date(Date.now() + rule.confirmDays * 86_400_000),
    }).returning({ id: deals.id });
    await tx.insert(dealStateHistory).values({ dealId, fromState: null, toState: "pending", actor: `vendor:${vendor.id}`, reason: `Verified ${payload.type} event accepted` });
    return { status: "accepted" as const, kf_event_id: eventId, deal_id: dealId };
  });
}
