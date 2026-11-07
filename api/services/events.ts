import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { attributionRecords, commissionRules, consentLogs, dealStateHistory, deals, products, promotionLinks, recordedSales, reps, vendorEvents, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { creditDealLocked, InsufficientEscrowError, payRepNow, reverseDeal } from "./ledger";
import { log } from "../lib/logger";
import { hashCustomerRef, hashPhone } from "./security";
import { redactVendorEventPayload, VENDOR_PAYLOAD_RETENTION_MS } from "./ingestionPolicy";
import { promotionCapacityForNewDeal, resolvePromotionLink, resolvePromotionLinkById } from "./promotions";
import { enqueuePromotionEvent } from "./promotionSignals";
import { recordVerifiedRenewalRecurrence, renewalAdmissionProblem, renewalScheduleForCustomer } from "./recurrence";
import { resolveAttributionToken } from "./attribution";

export type VendorEventInput = {
  event_id: string;
  type: "account_created" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "refund" | "sale";
  occurred_at: string;
  customer: { phone: string; customer_ref?: string };
  product_ref: string;
  amount_kobo?: number;
  /** Units sold, for "sale" events. A flat commission is paid per unit. */
  quantity?: number;
  meta?: Record<string, unknown>;
};

/** A sale held because no rep is linked to the customer yet. The first rep to link them within 24 hours picks it up. */
export const NO_REP_YET = "No rep linked to this customer yet; the first rep to link them within 24 hours picks it up";
const PICK_UP_WINDOW_MS = 24 * 3_600_000;

type IngestTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export type IngestVendorEventOptions = {
  credentialId?: number | null;
  identifiers?: { customerPhoneHash: string; customerRefHash: string };
  promotionLinkId?: number | null;
  /** Runs in the same transaction once the deal exists; throwing undoes the whole event, deal and all. */
  afterDeal?: (tx: IngestTransaction, dealId: number) => Promise<void>;
  /** Credit the rep now instead of after the waiting period. Throws InsufficientEscrowError (undoing everything) if the vendor's wallet is short. */
  creditNow?: { actor: string; reason: string; actorUserId?: number };
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
    customerPhoneHash: phoneHash,
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
  let attributionHandoff: ReturnType<typeof resolveAttributionToken> = null;
  let attributionHandoffToken: string | null = null;
  if (payload.type !== "refund") {
    const rawHandoffToken = typeof payload.meta?.kf_token === "string" ? payload.meta.kf_token : null;
    try {
      if (rawHandoffToken) {
        attributionHandoff = resolveAttributionToken(rawHandoffToken, { productId: product.id, vendorId: vendor.id });
        if (attributionHandoff) attributionHandoffToken = rawHandoffToken;
        else promotionLink = await resolvePromotionLink(rawHandoffToken);
      } else if (options.promotionLinkId) {
        promotionLink = await resolvePromotionLinkById(options.promotionLinkId);
      }
      if (promotionLink && (promotionLink.promotion.vendorId !== vendor.id || promotionLink.promotion.productId !== product.id)) {
        throw new Error("Promotion link does not match the vendor product");
      }
    } catch {
      await db.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "Invalid, expired, paused, or product-mismatched attribution or promotion link" });
      return { status: "quarantined" as const, kf_event_id: eventId, reason: "Attribution or promotion link is not eligible for new acquisition" };
    }
  }
  if (payload.type === "refund") {
    const [deal] = await db.select().from(deals).where(and(eq(deals.customerPhoneHash, phoneHash), eq(deals.productId, product.id))).orderBy(desc(deals.createdAt)).limit(1);
    await db.insert(vendorEvents).values({ ...baseEvent, dealId: deal?.id || null });
    if (!deal) return { status: "ignored" as const, kf_event_id: eventId, reason: "No matching deal to reverse" };
    const result = await reverseDeal(deal.id, `vendor:${vendor.id}:refund`);
    return { status: "processed" as const, kf_event_id: eventId, ...result };
  }

  let creditedRepId: number | null = null;
  const outcome = await db.transaction(async (tx) => {
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
    if (!attribution && attributionHandoff && attributionHandoffToken) {
      const [activeRep] = await tx.select({ id: reps.id }).from(reps).where(and(eq(reps.id, attributionHandoff.repId), eq(reps.status, "active"))).limit(1);
      if (!activeRep) {
        await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "Signed attribution representative is not active" });
        return { status: "quarantined" as const, kf_event_id: eventId, reason: "Signed attribution representative is not active" };
      }
      const inserted = await tx.insert(attributionRecords).values({
        repId: activeRep.id,
        customerPhoneHash: phoneHash,
        productId: product.id,
        vendorId: vendor.id,
        source: "link",
        tokenSig: attributionHandoffToken.slice(-48),
        claimExpiresAt: new Date(Date.now() + 24 * 3_600_000),
      }).onConflictDoNothing({ target: [attributionRecords.customerPhoneHash, attributionRecords.vendorId] }).returning();
      if (inserted.length) {
        attribution = inserted[0];
        await tx.insert(consentLogs).values({ phoneHash, purpose: "Signed vendor handoff attribution and onboarding", policyVersion: "privacy-v1.0" });
      } else {
        const [firstTouch] = await tx.select().from(attributionRecords).where(and(eq(attributionRecords.customerPhoneHash, phoneHash), eq(attributionRecords.vendorId, vendor.id))).limit(1);
        if (firstTouch?.status === "active") attribution = firstTouch;
      }
    }
    if (!attribution) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: NO_REP_YET });
      return { status: "quarantined" as const, kf_event_id: eventId, reason: "No active attribution" };
    }
    const trigger = (payload.type === "account_created" ? "signup" : payload.type) as typeof commissionRules.$inferInsert.triggerEvent;
    const recurrenceSchedule = payload.type === "renewal" ? await renewalScheduleForCustomer(tx, { vendorId: vendor.id, productId: product.id, customerPhoneHash: phoneHash }) : null;
    if (recurrenceSchedule && recurrenceSchedule.repId !== attribution.repId) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "Recurrence attribution does not match the original first-touch representative" });
      return { status: "quarantined" as const, kf_event_id: eventId, reason: "Recurrence first-touch attribution mismatch" };
    }
    const [rule] = recurrenceSchedule
      ? await tx.select().from(commissionRules).where(eq(commissionRules.id, recurrenceSchedule.commissionRuleId)).limit(1)
      : await tx.select().from(commissionRules).where(and(eq(commissionRules.productId, product.id), eq(commissionRules.triggerEvent, trigger), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.version)).limit(1);
    if (!rule) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "ignored", quarantineReason: "Event does not trigger the active commission rule" });
      return { status: "ignored" as const, kf_event_id: eventId, reason: "This event doesn't trigger the product's active commission rule" };
    }
    // A one-time activation commission is earned once per customer: a later event of the same kind (a second
    // deposit, or a vendor retry with a new event_id) must not pay again. Renewals are paid per cycle above. The
    // attribution row is locked so two concurrent events cannot both pass.
    // Product sales are paid per sale, so a customer buying again earns again.
    if (payload.type !== "renewal" && payload.type !== "sale") {
      await tx.select({ id: attributionRecords.id }).from(attributionRecords).where(eq(attributionRecords.id, attribution.id)).for("update");
      const [earned] = await tx.select({ id: deals.id }).from(deals)
        .where(and(eq(deals.attributionId, attribution.id), eq(deals.productId, product.id), eq(deals.triggerEvent, trigger))).limit(1);
      if (earned) {
        await tx.insert(vendorEvents).values({ ...baseEvent, status: "ignored", quarantineReason: `Commission already earned for this customer (deal ${earned.id})` });
        return { status: "ignored" as const, kf_event_id: eventId, reason: "Commission already earned for this customer", deal_id: earned.id, dealCreated: false };
      }
    }
    const recurrenceProblem = payload.type === "renewal" ? renewalAdmissionProblem(recurrenceSchedule, new Date()) : null;
    if (recurrenceProblem) {
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "ignored", quarantineReason: recurrenceProblem });
      return { status: "ignored" as const, kf_event_id: eventId, reason: recurrenceProblem, dealCreated: false };
    }
    let commission: ReturnType<typeof splitCommission>;
    try {
      commission = splitCommission(calculateVendorCommissionKobo(rule, payload.amount_kobo || null, payload.type === "sale" ? payload.quantity || 1 : 1));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Commission calculation failed";
      await tx.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: reason });
      return { status: "quarantined" as const, kf_event_id: eventId, reason };
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
    // No daily limit on sales per rep: each sale is checked (by Operations from its proof, or reported by the
    // vendor, who pays for it). Fraud reviews and payout holds are opened by Operations when needed.
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
    await tx.update(vendorEvents).set({ dealId }).where(eq(vendorEvents.id, eventId));
    await tx.insert(dealStateHistory).values({ dealId, fromState: null, toState: "pending", actor: `vendor:${vendor.id}`, reason: `Verified ${payload.type} event accepted` });
    if (payload.type === "renewal") await recordVerifiedRenewalRecurrence(tx, {
      dealId,
      vendorId: vendor.id,
      productId: product.id,
      repId: attribution.repId,
      commissionRuleId: rule.id,
      customerPhoneHash: phoneHash,
      customerRefHash,
      vendorEventId: eventId,
      promotionLinkId: promotionLink?.link.id || null,
      scheduleId: recurrenceSchedule?.id || null,
    });
    if (promotionLink && attribution.promotionId === promotionLink.promotion.id) {
      await tx.update(promotionLinks).set({ lastUsedAt: new Date() }).where(eq(promotionLinks.id, promotionLink.link.id));
    }
    // A rep who recorded this sale themselves sees it verified by the vendor's report (an Operations approval
    // records itself in services/recordedSales.ts).
    const vendorReported = (payload.meta as { verified_by?: string } | undefined)?.verified_by !== "operations";
    if (vendorReported) {
      const matched = await tx.update(recordedSales).set({ state: "verified", verifiedBy: "vendor", dealId, decidedAt: new Date() })
        .where(and(
          eq(recordedSales.vendorId, vendor.id), eq(recordedSales.customerPhoneHash, phoneHash), eq(recordedSales.repId, attribution.repId), eq(recordedSales.state, "waiting"),
          ...(payload.type === "sale" ? [eq(recordedSales.productId, product.id)] : []),
        )).returning({ id: recordedSales.id });
      // A product sale the vendor reports comes off their stock (never below zero: the vendor's own system is the record).
      if (payload.type === "sale") {
        await tx.update(products).set({ stockQuantity: sql`greatest(${products.stockQuantity} - ${payload.quantity || 1}, 0)`, updatedAt: new Date() })
          .where(and(eq(products.id, product.id), isNotNull(products.stockQuantity)));
      }
      // The vendor confirming a sale a rep recorded is a verification: credit the rep now if the wallet covers it
      // (otherwise the confirmation job credits it once the vendor adds funds).
      if (matched.length && !options.creditNow) {
        const credit = await creditDealLocked(tx, dealId, { actor: `vendor:${vendor.id}`, reason: "Vendor reported the sale the rep recorded; commission credited" });
        if (credit.credited) creditedRepId = attribution.repId;
      }
    }
    if (options.afterDeal) await options.afterDeal(tx, dealId);
    if (options.creditNow) {
      const credit = await creditDealLocked(tx, dealId, options.creditNow);
      if (!credit.credited) throw new InsufficientEscrowError(("balanceKobo" in credit && credit.balanceKobo) || 0, ("neededKobo" in credit && credit.neededKobo) || commission.vendorCommissionKobo);
      creditedRepId = attribution.repId;
    }
    return { status: "accepted" as const, kf_event_id: eventId, deal_id: dealId, promotion_id: attribution.promotionId || null, credited: creditedRepId !== null };
  });
  // A verified sale is paid out straight away, once the credit is committed. A payout that can't go yet (no confirmed
  // bank account, an ID check, a fraud hold) leaves the money in the wallet for the daily run; it never undoes the sale.
  if (creditedRepId !== null) {
    await payRepNow(creditedRepId, options.creditNow?.actorUserId).catch((error) => log.warn("instant payout not queued", { repId: creditedRepId, error: error instanceof Error ? error.message : String(error) }));
  }
  return outcome;
}

/**
 * Called after a rep is newly linked to a customer: any sale from that vendor for that customer that was held in the
 * last 24 hours because no rep was linked is sent through the normal process again, so it is credited to this rep
 * if it would have been. Every usual check still applies (the event must trigger the commission, not already earned,
 * the rep's daily cap, the vendor's wallet). Each held sale is picked up at most once.
 */
export async function pickUpHeldSales(input: { vendorId: number; customerPhoneHash: string; repId: number }) {
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
  if (!vendor || vendor.status !== "active") return [];
  const held = await db.select().from(vendorEvents).where(and(
    eq(vendorEvents.vendorId, input.vendorId),
    eq(vendorEvents.customerPhoneHash, input.customerPhoneHash),
    eq(vendorEvents.status, "quarantined"),
    eq(vendorEvents.quarantineReason, NO_REP_YET),
    isNull(vendorEvents.pickedUpAt),
    gt(vendorEvents.receivedAt, new Date(Date.now() - PICK_UP_WINDOW_MS)),
  )).orderBy(asc(vendorEvents.receivedAt));
  const results: { heldEventId: string; status: string; dealId?: number }[] = [];
  for (const event of held) {
    // Claim the held sale first, so two reps (or two clicks) can't both pick it up.
    const claimed = await db.update(vendorEvents).set({ pickedUpAt: new Date() })
      .where(and(eq(vendorEvents.id, event.id), isNull(vendorEvents.pickedUpAt))).returning({ id: vendorEvents.id });
    if (!claimed.length) continue;
    const original = event.payloadJson as VendorEventInput;
    const result = await ingestVendorEvent(vendor.webhookKey, { ...original, event_id: `${original.event_id}:picked-up` }, {
      identifiers: { customerPhoneHash: input.customerPhoneHash, customerRefHash: event.customerRefHash },
    });
    await db.update(vendorEvents).set({ pickedUpEventId: result.kf_event_id ? String(result.kf_event_id) : null }).where(eq(vendorEvents.id, event.id));
    results.push({ heldEventId: event.id, status: result.status, dealId: "deal_id" in result ? (result as { deal_id?: number }).deal_id : undefined });
  }
  return results;
}
