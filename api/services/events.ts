import { and, desc, eq } from "drizzle-orm";
import { attributionRecords, commissionRules, dealStateHistory, deals, products, vendorEvents, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { reverseDeal } from "./ledger";
import { hashCustomerRef, hashPhone } from "./security";

export type VendorEventInput = {
  event_id: string;
  type: "account_created" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "refund";
  occurred_at: string;
  customer: { phone: string; customer_ref?: string };
  product_ref: string;
  amount_kobo?: number;
  meta?: Record<string, unknown>;
};

export async function ingestVendorEvent(vendorKey: string, payload: VendorEventInput) {
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, vendorKey)).limit(1);
  if (!vendor || vendor.status !== "active") throw new Error("Unknown or inactive vendor");
  const [duplicate] = await db.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, `${vendor.id}:${payload.event_id}`)).limit(1);
  if (duplicate) return { status: "duplicate" as const, kf_event_id: duplicate.id };
  const [product] = await db.select().from(products).where(and(eq(products.vendorRef, payload.product_ref), eq(products.vendorId, vendor.id))).limit(1);
  const phoneHash = hashPhone(payload.customer.phone);
  const eventId = crypto.randomUUID();
  const baseEvent = {
    id: eventId,
    vendorId: vendor.id,
    type: payload.type,
    customerRefHash: hashCustomerRef(payload.customer.customer_ref || payload.customer.phone),
    productId: product?.id || null,
    amountKobo: payload.amount_kobo || null,
    payloadJson: { ...payload, customer: { phone: "[redacted]", customer_ref: payload.customer.customer_ref ? "[hashed]" : undefined } },
    hmacOk: true,
    dedupeKey: `${vendor.id}:${payload.event_id}`,
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
  const [attribution] = await db.select().from(attributionRecords).where(and(eq(attributionRecords.customerPhoneHash, phoneHash), eq(attributionRecords.vendorId, vendor.id), eq(attributionRecords.status, "active"))).limit(1);
  if (!attribution) {
    await db.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: "No active first-touch attribution; eligible for 24h claim review" });
    return { status: "quarantined" as const, kf_event_id: eventId, reason: "No active attribution" };
  }
  const trigger = payload.type === "account_created" ? "signup" : payload.type;
  const [rule] = await db.select().from(commissionRules).where(and(eq(commissionRules.productId, product.id), eq(commissionRules.triggerEvent, trigger as any))).orderBy(desc(commissionRules.version)).limit(1);
  if (!rule) {
    await db.insert(vendorEvents).values({ ...baseEvent, status: "ignored", quarantineReason: "Event does not trigger the active commission rule" });
    return { status: "ignored" as const, kf_event_id: eventId };
  }
  let commission: ReturnType<typeof splitCommission>;
  try {
    commission = splitCommission(calculateVendorCommissionKobo(rule, payload.amount_kobo || null));
  } catch (error) {
    await db.insert(vendorEvents).values({ ...baseEvent, status: "quarantined", quarantineReason: error instanceof Error ? error.message : "Commission calculation failed" });
    return { status: "quarantined" as const, kf_event_id: eventId };
  }
  await db.insert(vendorEvents).values(baseEvent);
  const [{ id: dealId }] = await db.insert(deals).values({ attributionId: attribution.id, productId: product.id, vendorId: vendor.id, repId: attribution.repId, customerPhoneHash: phoneHash, triggerEvent: trigger, eventId, state: "pending", ...commission, confirmAt: new Date(Date.now() + rule.confirmDays * 86_400_000) }).$returningId();
  await db.insert(dealStateHistory).values({ dealId, fromState: null, toState: "pending", actor: `vendor:${vendor.id}`, reason: `Verified ${payload.type} event accepted` });
  return { status: "accepted" as const, kf_event_id: eventId, deal_id: dealId };
}
