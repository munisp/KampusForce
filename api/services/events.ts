import { and, desc, eq, isNull } from "drizzle-orm";
import { attributionRecords, commissionRules, consentLogs, dealStateHistory, deals, products, promotionLinks, vendorEvents, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { enforceActivationVelocity } from "./fraud";
import { reverseDeal } from "./ledger";
import { hashCustomerRef, hashPhone } from "./security";
import { redactVendorEventPayload, VENDOR_PAYLOAD_RETENTION_MS } from "./ingestionPolicy";
import { promotionCapacityForNewDeal, resolvePromotionLink, resolvePromotionLinkById } from "./promotions";
import { enqueuePromotionEvent } from "./promotionSignals";

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
  promotionLinkId?: number | null;
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
  let promotionLink: Awaited<ReturnType<typeof resolvePromotionLink>> | null = null;
  if (payload.type !== "refund") {
    const rawPromotionToken = typeof payload.meta?.kf_token === "string" ? payload.meta.kf_token : null;
    try {
      if (rawPromotionToken) promotionLink = await resolvePromotionLink(rawPromotionToken);
      else if (options.promotionLinkId) promotionLink = await resolvePromotionLinkById(options.promotionLinkId);
      if (promotionLink && (promotionLink.promotion.vendorId !== vendor.id || promotionLink.promotion.productId !== product.id)) {
        throw new Error("Promotion link does not match the vendor product");
      }
    } catch {
      await db.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "Invalid, expired, paused, or product-mismatched promotion link" });
      return { status: "quarantined" as const, kf_event_id: eventId, reason: "Promotion link is not eligible for new acquisition" };
    }
  }
  if (payload.type === "refund") {
    const [deal] = await db.select().from(deals).where(and(eq(deals.customerPhoneHash, phoneHash), eq(deals.productId, product.id))).orderBy(desc(deals.createdAt)).limit(1);
    await db.insert(vendorEvents).values({ ...baseEvent, dealId: deal?.id || null });
    if (!deal) return { status: "ignored" as const, kf_event_id: eventId, reason: "No matching deal to reverse" };
    const result = await reverseDeal(deal.id, `vendor:${vendor.id}:refund`);
    return { status: "processed" as const, kf_event_id: eventId, ...result };
  }

  return db.transaction(async (tx) => {
    // Serializing the vendor's ingestion transaction makes the dedupe recheck authoritative.
    await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendor.id)).limit(1).for("update");
    const [concurrentDuplicate] = await tx.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, dedupeKey)).limit(1);
    if (concurrentDuplicate) return { status: "duplicate" as const, kf_event_id: concurrentDuplicate.id };
    let [attribution] = await tx.select().from(attributionRecords).where(and(eq(attributionRecords.customerPhoneHash, phoneHash), eq(attributionRecords.vendorId, vendor.id), eq(attributionRecords.status, "active"))).limit(1);
    if (!attribution && promotionLink) {
      const [created] = await tx.insert(attributionRecords).values({
        repId: promotionLink.rep.id,
        customerPhoneHash: phoneHash,
        productId: product.id,
        vendorId: vendor.id,
        promotionId: promotionLink.promotion.id,
        source: "link",
        tokenSig: promotionLink.link.tokenHash.slice(0, 48),
        claimExpiresAt: new Date(Date.now() + 24 * 3_600_000),
      }).returning();
      attribution = created;
      await tx.insert(consentLogs).values({ phoneHash, purpose: "Promotion attribution and vendor-assisted onboarding", policyVersion: "privacy-v1.0" });
    }
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
    if (attribution.promotionId) {
      const capacity = await promotionCapacityForNewDeal(tx, attribution.promotionId, commission.vendorCommissionKobo);
      if (!capacity.allowed) {
        const reason = capacity.reason === "budget_cap" ? "Promotion budget cap reached" : capacity.reason === "escrow_depleted" ? "Uncommitted vendor escrow is insufficient" : "Promotion is not accepting new activations";
        await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: reason });
        if (capacity.reason === "budget_cap" || capacity.reason === "escrow_depleted") {
          await enqueuePromotionEvent({ promotionId: attribution.promotionId, eventType: "promotion.budget_exhausted", eventKey: `promotion:${attribution.promotionId}:capacity-block:${eventId}`, payloadJson: { dealId: null, reason: capacity.reason, preserveEarnedPayouts: true } }, tx);
        }
        return { status: "quarantined" as const, kf_event_id: eventId, reason, escrowDebited: false, ledgerEntriesCreated: 0 };
      }
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
    if (promotionLink && attribution.promotionId === promotionLink.promotion.id) {
      await tx.update(promotionLinks).set({ lastUsedAt: new Date() }).where(eq(promotionLinks.id, promotionLink.link.id));
    }
    return { status: "accepted" as const, kf_event_id: eventId, deal_id: dealId, promotion_id: attribution.promotionId || null };
  });
}
