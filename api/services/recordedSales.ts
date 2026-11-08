import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, commissionRules, deals, products, recordedSales, reps, users, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { ensureAttribution } from "./attribution";
import { ingestVendorEvent, pickUpHeldSales, type VendorEventInput } from "./events";
import { storeSaleProof } from "./identityDocuments";
import { splitCommission } from "./money";
import { notifyUser } from "./notifications";
import { hashCustomerRef, normalizePhone } from "./security";
import { openDealDispute } from "./ledger";
import { assertProductTrainingPassed } from "./training";

// A rep records a sale they made, with proof. It shows as waiting for verification straight away, and is verified when
// the vendor reports that customer or approved by Operations. Either way the sale goes through the normal sale process
// (ingestVendorEvent), so the waiting period, the vendor's wallet, the once-per-customer rule and the daily cap all apply.

const TRIGGER_EVENT: Record<string, VendorEventInput["type"]> = {
  signup: "account_created", kyc_complete: "kyc_complete", funded: "funded", first_transaction: "first_transaction", renewal: "renewal",
};

async function currentRule(productId: number) {
  const [rule] = await getDb().select().from(commissionRules).where(and(eq(commissionRules.productId, productId), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.id)).limit(1);
  return rule;
}

/** What the rep earns, when it doesn't depend on the sale amount. */
function expectedRepCommission(rule: Awaited<ReturnType<typeof currentRule>>) {
  if (!rule || rule.basis !== "flat" || !rule.flatAmountKobo) return null;
  return splitCommission(Math.round(rule.flatAmountKobo)).repCommissionKobo;
}

export async function recordSale(input: { userId: number; productId: number; customerPhone: string; proofBase64: string; note?: string }) {
  const db = getDb();
  const [rep] = await db.select().from(reps).where(eq(reps.userId, input.userId)).limit(1);
  if (!rep || rep.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Operations needs to activate you before you can record sales." });
  const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.status, "active"))).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Choose a product from the list." });
  await assertProductTrainingPassed(input.userId, product.id);
  let phone: string;
  try { phone = normalizePhone(input.customerPhone); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Check the customer's phone number and try again." }); }

  const link = await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: phone, source: "claim", actorUserId: input.userId })
    .catch(() => { throw new TRPCError({ code: "BAD_REQUEST", message: "Check the customer's phone number and try again." }); });
  if (link.attribution.repId !== rep.id) throw new TRPCError({ code: "CONFLICT", message: "Another rep already has this customer. The first rep to link a customer gets their sales." });
  const [existing] = await db.select({ id: recordedSales.id, state: recordedSales.state }).from(recordedSales)
    .where(and(eq(recordedSales.vendorId, product.vendorId), eq(recordedSales.customerPhoneHash, link.phoneHash), eq(recordedSales.repId, rep.id))).orderBy(desc(recordedSales.id)).limit(1);
  if (existing && existing.state !== "rejected") throw new TRPCError({ code: "CONFLICT", message: existing.state === "waiting" ? "You've already recorded this customer. It's waiting for verification." : "This sale is already verified. It's in your Earnings." });

  const proof = await storeSaleProof({ actorUserId: input.userId, contentBase64: input.proofBase64 });
  const [sale] = await db.insert(recordedSales).values({
    repId: rep.id, productId: product.id, vendorId: product.vendorId,
    customerPhoneHash: link.phoneHash, customerPhoneLast4: phone.slice(-4),
    proofDocumentId: proof.id, note: input.note?.trim() || null,
  }).returning();
  await db.insert(auditLogs).values({ actorUserId: input.userId, action: "recorded_sale.created", entityType: "recorded_sale", entityId: String(sale.id), metadataJson: { productId: product.id, vendorId: product.vendorId } });

  // The vendor may already have reported this customer (a held sale): that verifies it straight away.
  if (link.created) await pickUpHeldSales({ vendorId: product.vendorId, customerPhoneHash: link.phoneHash, repId: rep.id });
  const [after] = await db.select().from(recordedSales).where(eq(recordedSales.id, sale.id)).limit(1);
  return { id: sale.id, state: after.state as "waiting" | "verified", verifiedBy: after.verifiedBy, expectedRepCommissionKobo: expectedRepCommission(await currentRule(product.id)) };
}

export async function approveRecordedSale(input: { id: number; reviewerUserId: number; reason: string }) {
  const db = getDb();
  const [sale] = await db.select().from(recordedSales).where(eq(recordedSales.id, input.id)).limit(1);
  if (!sale || sale.state !== "waiting") throw new TRPCError({ code: "CONFLICT", message: "This sale isn't waiting for verification any more. Refresh the list." });
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, sale.vendorId)).limit(1);
  const [product] = await db.select().from(products).where(eq(products.id, sale.productId)).limit(1);
  const rule = await currentRule(sale.productId);
  if (!vendor || vendor.status !== "active" || !product || !rule) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The vendor or product isn't active any more, so this sale can't be approved." });
  // Approval sends the event the product pays for through the normal sale process, on the vendor's behalf.
  const result = await ingestVendorEvent(vendor.webhookKey, {
    event_id: `ops-verified:${sale.id}`,
    type: TRIGGER_EVENT[rule.triggerEvent],
    occurred_at: sale.createdAt.toISOString(),
    customer: { phone: "[recorded]" },
    product_ref: product.vendorRef,
    meta: { verified_by: "operations", recorded_sale_id: sale.id },
  }, { identifiers: { customerPhoneHash: sale.customerPhoneHash, customerRefHash: hashCustomerRef(`recorded-sale:${sale.id}`) } });
  if (result.status !== "accepted" || !("deal_id" in result) || !result.deal_id) {
    const why = "reason" in result && result.reason ? String(result.reason) : "the sale process didn't accept it";
    throw new TRPCError({ code: "CONFLICT", message: `Couldn't approve: ${why}.` });
  }
  await db.update(recordedSales).set({ state: "verified", verifiedBy: "operations", reviewerUserId: input.reviewerUserId, reviewReason: input.reason, dealId: result.deal_id, decidedAt: new Date() }).where(eq(recordedSales.id, sale.id));
  await db.insert(auditLogs).values({ actorUserId: input.reviewerUserId, action: "recorded_sale.approved", entityType: "recorded_sale", entityId: String(sale.id), metadataJson: { dealId: result.deal_id } });
  const [rep] = await db.select({ userId: reps.userId }).from(reps).where(eq(reps.id, sale.repId)).limit(1);
  if (rep) await notifyUser({ userId: rep.userId, type: "recorded_sale_approved", title: "Your sale was verified", body: `Operations verified the ${product.name} sale you recorded. It's in your Earnings.`, href: "/rep/earnings", entityType: "recorded_sale", entityId: sale.id });
  if (vendor.userId) await notifyUser({ userId: vendor.userId, type: "recorded_sale_approved_vendor", title: "KampusForce verified a rep's sale", body: `Operations verified a ${product.name} sale a campus rep recorded. If it didn't happen, dispute it on your dashboard.`, href: "/vendor", entityType: "recorded_sale", entityId: sale.id });
  return { id: sale.id, state: "verified" as const, dealId: result.deal_id };
}

export async function rejectRecordedSale(input: { id: number; reviewerUserId: number; reason: string }) {
  const db = getDb();
  const updated = await db.update(recordedSales).set({ state: "rejected", reviewerUserId: input.reviewerUserId, reviewReason: input.reason, decidedAt: new Date() })
    .where(and(eq(recordedSales.id, input.id), eq(recordedSales.state, "waiting"))).returning();
  if (!updated.length) throw new TRPCError({ code: "CONFLICT", message: "This sale isn't waiting for verification any more. Refresh the list." });
  const sale = updated[0];
  await db.insert(auditLogs).values({ actorUserId: input.reviewerUserId, action: "recorded_sale.rejected", entityType: "recorded_sale", entityId: String(sale.id), metadataJson: {} });
  const [rep] = await db.select({ userId: reps.userId }).from(reps).where(eq(reps.id, sale.repId)).limit(1);
  const [product] = await db.select({ name: products.name }).from(products).where(eq(products.id, sale.productId)).limit(1);
  if (rep) await notifyUser({ userId: rep.userId, type: "recorded_sale_rejected", title: "A sale you recorded wasn't verified", body: `Operations couldn't verify the ${product?.name || "product"} sale: ${input.reason}`, href: "/rep/record", entityType: "recorded_sale", entityId: sale.id });
  return { id: sale.id, state: "rejected" as const };
}

const listColumns = {
  sale: recordedSales, productName: products.name, vendorName: vendors.companyName, repName: users.name, repCode: reps.code, dealState: deals.state,
};

export function repRecordedSales(repId: number) {
  return getDb().select(listColumns).from(recordedSales)
    .innerJoin(products, eq(products.id, recordedSales.productId)).innerJoin(vendors, eq(vendors.id, recordedSales.vendorId))
    .innerJoin(reps, eq(reps.id, recordedSales.repId)).innerJoin(users, eq(users.id, reps.userId)).leftJoin(deals, eq(deals.id, recordedSales.dealId))
    .where(eq(recordedSales.repId, repId)).orderBy(desc(recordedSales.createdAt)).limit(100);
}

export function salesToVerify() {
  return getDb().select(listColumns).from(recordedSales)
    .innerJoin(products, eq(products.id, recordedSales.productId)).innerJoin(vendors, eq(vendors.id, recordedSales.vendorId))
    .innerJoin(reps, eq(reps.id, recordedSales.repId)).innerJoin(users, eq(users.id, reps.userId)).leftJoin(deals, eq(deals.id, recordedSales.dealId))
    .where(eq(recordedSales.state, "waiting")).orderBy(desc(recordedSales.createdAt)).limit(100);
}

/** Sales Operations verified for this vendor without the vendor reporting them, so the vendor can check and dispute. */
export function vendorOpsVerifiedSales(vendorId: number) {
  return getDb().select(listColumns).from(recordedSales)
    .innerJoin(products, eq(products.id, recordedSales.productId)).innerJoin(vendors, eq(vendors.id, recordedSales.vendorId))
    .innerJoin(reps, eq(reps.id, recordedSales.repId)).innerJoin(users, eq(users.id, reps.userId)).leftJoin(deals, eq(deals.id, recordedSales.dealId))
    .where(and(eq(recordedSales.vendorId, vendorId), eq(recordedSales.verifiedBy, "operations"))).orderBy(desc(recordedSales.decidedAt)).limit(100);
}

export async function vendorDisputeRecordedSale(input: { vendorId: number; actorUserId: number; id: number; reason: string }) {
  const db = getDb();
  const [sale] = await db.select().from(recordedSales).where(and(eq(recordedSales.id, input.id), eq(recordedSales.vendorId, input.vendorId), eq(recordedSales.verifiedBy, "operations"))).limit(1);
  if (!sale?.dealId) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
  // Same hold-and-review process as any commission dispute: the sale is held and Operations decides.
  return openDealDispute({ dealId: sale.dealId, repId: sale.repId, actorUserId: input.actorUserId, reasonCode: "vendor_disputes_verified_sale", evidence: input.reason });
}
