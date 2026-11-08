import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, commissionRules, deals, escrowTopups, escrowWallets, identityDocuments, ledgerEntries, products, recordedSales, reps, users, vendorEvents, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { ensureAttribution } from "./attribution";
import { ingestVendorEvent, pickUpHeldSales, type VendorEventInput } from "./events";
import { storeSaleProof } from "./identityDocuments";
import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { notifyUser } from "./notifications";
import { hashCustomerRef, normalizePhone } from "./security";
import { InsufficientEscrowError, openDealDispute } from "./ledger";
import { assertProductTrainingPassed } from "./training";

// A rep records a sale they made, with proof. It shows at once to the rep (waiting for verification) and on the
// vendor's dashboard. Operations approves or rejects it; the vendor reporting the same customer also verifies it.
// Approval goes through the normal sale process (ingestVendorEvent), so the vendor's wallet, the once-per-customer
// rule (for sign-up style products) and the daily cap all apply, and in the same transaction: the stock goes down,
// the commission leaves the vendor's wallet, and the rep's share lands in their wallet. The refund period starts then.

const TRIGGER_EVENT: Record<string, VendorEventInput["type"]> = {
  signup: "account_created", kyc_complete: "kyc_complete", funded: "funded", first_transaction: "first_transaction", renewal: "renewal", sale: "sale",
};

export const MAX_SALE_QUANTITY = 100;

class OutOfStockError extends Error {
  readonly left: number;
  constructor(left: number) { super("Not enough stock"); this.left = left; }
}

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

async function currentRule(productId: number) {
  const [rule] = await getDb().select().from(commissionRules).where(and(eq(commissionRules.productId, productId), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.id)).limit(1);
  return rule;
}

type Rule = NonNullable<Awaited<ReturnType<typeof currentRule>>>;

/** The commission split for a sale under a rule, or null when it depends on an amount nobody has given yet. */
export function expectedSplit(rule: Pick<Rule, "basis" | "pctBps" | "flatAmountKobo" | "triggerEvent"> | undefined | null, amountKobo: number | null, quantity = 1) {
  if (!rule) return null;
  try {
    return splitCommission(calculateVendorCommissionKobo(rule, amountKobo, rule.triggerEvent === "sale" ? quantity : 1));
  } catch {
    return null;
  }
}

export async function recordSale(input: { userId: number; productId: number; customerPhone: string; proofBase64: string; note?: string; quantity?: number }) {
  const db = getDb();
  const [rep] = await db.select().from(reps).where(eq(reps.userId, input.userId)).limit(1);
  if (!rep || rep.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Operations needs to activate you before you can record sales." });
  const [row] = await db.select({ product: products, vendorStatus: vendors.status, vendorUserId: vendors.userId }).from(products).innerJoin(vendors, eq(vendors.id, products.vendorId))
    .where(and(eq(products.id, input.productId), eq(products.status, "active"))).limit(1);
  if (!row || row.vendorStatus !== "active") throw new TRPCError({ code: "NOT_FOUND", message: "Choose a product from the list." });
  const { product } = row;
  await assertProductTrainingPassed(input.userId, product.id);
  const rule = await currentRule(product.id);
  if (!rule) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This product has no commission terms yet, so sales can't be recorded." });

  // Product sales record what was sold: units at the listed price, within the stock the vendor has.
  const isProductSale = rule.triggerEvent === "sale";
  const quantity = isProductSale ? input.quantity ?? 1 : 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SALE_QUANTITY) throw new TRPCError({ code: "BAD_REQUEST", message: `Enter how many you sold: 1 to ${MAX_SALE_QUANTITY}.` });
  if (isProductSale && product.priceKobo <= 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This product has no price yet. Ask the vendor to set one." });
  if (isProductSale && product.stockQuantity !== null && quantity > product.stockQuantity) {
    throw new TRPCError({ code: "BAD_REQUEST", message: product.stockQuantity === 0 ? "This product is sold out." : `Only ${product.stockQuantity} left in stock.` });
  }
  const unitPriceKobo = isProductSale ? product.priceKobo : null;
  const amountKobo = unitPriceKobo === null ? null : unitPriceKobo * quantity;

  let phone: string;
  try { phone = normalizePhone(input.customerPhone); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Check the customer's phone number and try again." }); }

  const link = await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: phone, source: "claim", actorUserId: input.userId })
    .catch(() => { throw new TRPCError({ code: "BAD_REQUEST", message: "Check the customer's phone number and try again." }); });
  if (link.attribution.repId !== rep.id) throw new TRPCError({ code: "CONFLICT", message: "Another rep already has this customer. The first rep to link a customer gets their sales." });
  const proofHash = createHash("sha256").update(Buffer.from(input.proofBase64, "base64")).digest("hex");
  // The checks and the insert run under two locks (this rep and customer, and this receipt), so a double-click or two
  // tabs can't both pass the checks before either sale is saved.
  const sale = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recorded-sale:${rep.id}:${link.phoneHash}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sale-proof:${proofHash}`}))`);
    if (isProductSale) {
      // A customer can buy again, but the same sale can't be waiting twice.
      const [waiting] = await tx.select({ id: recordedSales.id }).from(recordedSales)
        .where(and(eq(recordedSales.productId, product.id), eq(recordedSales.customerPhoneHash, link.phoneHash), eq(recordedSales.repId, rep.id), eq(recordedSales.state, "waiting"))).limit(1);
      if (waiting) throw new TRPCError({ code: "CONFLICT", message: "You've already recorded a sale of this product to this customer that's waiting for verification." });
    } else {
      const [existing] = await tx.select({ id: recordedSales.id, state: recordedSales.state }).from(recordedSales)
        .where(and(eq(recordedSales.vendorId, product.vendorId), eq(recordedSales.customerPhoneHash, link.phoneHash), eq(recordedSales.repId, rep.id))).orderBy(desc(recordedSales.id)).limit(1);
      if (existing && existing.state !== "rejected") throw new TRPCError({ code: "CONFLICT", message: existing.state === "waiting" ? "You've already recorded this customer. It's waiting for verification." : "This sale is already verified. It's in your Earnings." });
    }

    // The same receipt can't back two sales.
    const [reused] = await tx.select({ id: recordedSales.id }).from(recordedSales).innerJoin(identityDocuments, eq(identityDocuments.id, recordedSales.proofDocumentId))
      .where(and(eq(identityDocuments.sha256, proofHash), inArray(recordedSales.state, ["waiting", "verified"]))).limit(1);
    if (reused) throw new TRPCError({ code: "CONFLICT", message: "This proof was already used for another sale. Upload the proof for this sale." });

    const proof = await storeSaleProof({ actorUserId: input.userId, contentBase64: input.proofBase64 });
    const [created] = await tx.insert(recordedSales).values({
      repId: rep.id, productId: product.id, vendorId: product.vendorId,
      customerPhoneHash: link.phoneHash, customerPhoneLast4: phone.slice(-4),
      proofDocumentId: proof.id, note: input.note?.trim() || null,
      quantity, unitPriceKobo, amountKobo,
    }).returning();
    return created;
  });
  await db.insert(auditLogs).values({ actorUserId: input.userId, action: "recorded_sale.created", entityType: "recorded_sale", entityId: String(sale.id), metadataJson: { productId: product.id, vendorId: product.vendorId, quantity, amountKobo } });
  if (row.vendorUserId) {
    await notifyUser({ userId: row.vendorUserId, type: "recorded_sale_created", title: "A campus rep recorded a sale", body: `${isProductSale ? `${quantity} × ${product.name} (${naira(amountKobo || 0)})` : product.name}. KampusForce is checking the proof. You'll see it on your dashboard.`, href: "/vendor", entityType: "recorded_sale", entityId: sale.id });
  }

  // The vendor may already have reported this customer (a held sale): that verifies it straight away.
  if (link.created) await pickUpHeldSales({ vendorId: product.vendorId, customerPhoneHash: link.phoneHash, repId: rep.id });
  const [after] = await db.select().from(recordedSales).where(eq(recordedSales.id, sale.id)).limit(1);
  const split = expectedSplit(rule, amountKobo, quantity);
  return { id: sale.id, state: after.state as "waiting" | "verified", verifiedBy: after.verifiedBy, quantity, amountKobo, expectedRepCommissionKobo: split?.repCommissionKobo ?? null, expectedPlatformFeeKobo: split?.platformFeeKobo ?? null };
}

export async function approveRecordedSale(input: { id: number; reviewerUserId: number; reason: string; amountKobo?: number }) {
  const db = getDb();
  const [sale] = await db.select().from(recordedSales).where(eq(recordedSales.id, input.id)).limit(1);
  if (!sale || sale.state !== "waiting") throw new TRPCError({ code: "CONFLICT", message: "This sale isn't waiting for verification any more. Refresh the list." });
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, sale.vendorId)).limit(1);
  const [product] = await db.select().from(products).where(eq(products.id, sale.productId)).limit(1);
  const rule = await currentRule(sale.productId);
  if (!vendor || vendor.status !== "active" || !product || !rule) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The vendor or product isn't active any more, so this sale can't be approved." });

  // The amount the commission is worked out on: a product sale's own total; otherwise Operations reads it off the proof
  // when the commission is a percentage of it.
  const isProductSale = rule.triggerEvent === "sale";
  const amountKobo = isProductSale ? sale.amountKobo ?? product.priceKobo * sale.quantity : input.amountKobo ?? null;
  if (rule.basis === "pct" && !amountKobo) throw new TRPCError({ code: "BAD_REQUEST", message: `${product.name} pays a percentage of the sale amount. Enter the amount the customer paid, from the proof.` });
  const split = expectedSplit(rule, amountKobo, sale.quantity);
  if (!split) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This product's commission terms can't be worked out for this sale. Check the product's terms." });

  // Checked again inside the approval; this is for a clear message before anything is written.
  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  if (!wallet || wallet.balanceKobo < split.vendorCommissionKobo) return walletShort(vendor, product, wallet?.balanceKobo || 0, split.vendorCommissionKobo);
  if (isProductSale && product.stockQuantity !== null && sale.quantity > product.stockQuantity) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${product.name} has only ${product.stockQuantity} left in stock; this sale is for ${sale.quantity}. Ask the vendor to update their stock, or reject the sale.` });

  // Earlier approval attempts that the sale process turned down (a held or ignored event) don't block a new one: each
  // retry gets its own event id. Two clicks at once still compute the same id, so the dedupe check stops a second deal.
  const baseEventId = `ops-verified:${sale.id}`;
  const attempts = await db.select({ id: vendorEvents.id, dealId: vendorEvents.dealId }).from(vendorEvents)
    .where(and(eq(vendorEvents.vendorId, sale.vendorId), or(eq(vendorEvents.dedupeKey, `${sale.vendorId}:${baseEventId}`), like(vendorEvents.dedupeKey, `${sale.vendorId}:${baseEventId}:%`))));
  if (attempts.some((attempt) => attempt.dealId)) throw new TRPCError({ code: "CONFLICT", message: "This sale was already approved. Refresh the list." });

  let result: Awaited<ReturnType<typeof ingestVendorEvent>>;
  try {
    result = await ingestVendorEvent(vendor.webhookKey, {
      event_id: attempts.length ? `${baseEventId}:${attempts.length + 1}` : baseEventId,
      type: TRIGGER_EVENT[rule.triggerEvent],
      occurred_at: sale.createdAt.toISOString(),
      customer: { phone: "[recorded]" },
      product_ref: product.vendorRef,
      ...(amountKobo ? { amount_kobo: amountKobo } : {}),
      ...(isProductSale ? { quantity: sale.quantity } : {}),
      meta: { verified_by: "operations", recorded_sale_id: sale.id },
    }, {
      identifiers: { customerPhoneHash: sale.customerPhoneHash, customerRefHash: hashCustomerRef(`recorded-sale:${sale.id}`) },
      creditNow: { actor: `staff:${input.reviewerUserId}`, reason: "Sale approved by Operations; commission credited", actorUserId: input.reviewerUserId },
      afterDeal: async (tx, dealId) => {
        if (isProductSale && product.stockQuantity !== null) {
          const [left] = await tx.select({ stock: products.stockQuantity }).from(products).where(eq(products.id, product.id)).limit(1).for("update");
          if (left.stock !== null && left.stock < sale.quantity) throw new OutOfStockError(left.stock);
          if (left.stock !== null) await tx.update(products).set({ stockQuantity: left.stock - sale.quantity, updatedAt: new Date() }).where(eq(products.id, product.id));
        }
        const verified = await tx.update(recordedSales).set({ state: "verified", verifiedBy: "operations", reviewerUserId: input.reviewerUserId, reviewReason: input.reason, dealId, amountKobo: amountKobo ?? sale.amountKobo, decidedAt: new Date() })
          .where(and(eq(recordedSales.id, sale.id), eq(recordedSales.state, "waiting"))).returning({ id: recordedSales.id });
        if (!verified.length) throw new TRPCError({ code: "CONFLICT", message: "This sale isn't waiting for verification any more. Refresh the list." });
        await tx.insert(auditLogs).values({ actorUserId: input.reviewerUserId, action: "recorded_sale.approved", entityType: "recorded_sale", entityId: String(sale.id), metadataJson: { dealId, amountKobo, quantity: sale.quantity, ...split } });
      },
    });
  } catch (error) {
    if (error instanceof InsufficientEscrowError) return walletShort(vendor, product, error.balanceKobo, error.neededKobo);
    if (error instanceof OutOfStockError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${product.name} has only ${error.left} left in stock; this sale is for ${sale.quantity}. Ask the vendor to update their stock, or reject the sale.` });
    throw error;
  }
  if (result.status === "duplicate") throw new TRPCError({ code: "CONFLICT", message: "This sale is already being approved. Refresh the list." });
  if (result.status !== "accepted" || !("deal_id" in result) || !result.deal_id) {
    const why = "reason" in result && result.reason ? String(result.reason) : "the sale process didn't accept it";
    throw new TRPCError({ code: "CONFLICT", message: `Couldn't approve: ${why}.` });
  }
  const [deal] = await db.select().from(deals).where(eq(deals.id, result.deal_id)).limit(1);
  const [rep] = await db.select({ userId: reps.userId }).from(reps).where(eq(reps.id, sale.repId)).limit(1);
  const what = isProductSale ? `${sale.quantity} × ${product.name}` : product.name;
  // ingestVendorEvent has already asked for the payout; if it went ahead, the deal is linked to it.
  const paidOut = Boolean(deal.payoutId);
  if (rep) await notifyUser({ userId: rep.userId, type: "recorded_sale_approved", title: paidOut ? `${naira(deal.repCommissionKobo)} is on its way to your bank` : `${naira(deal.repCommissionKobo)} added to your wallet`, body: paidOut
    ? `Operations verified the ${what} sale you recorded. Your share is being paid to your bank now, less any tax withheld.`
    : `Operations verified the ${what} sale you recorded. Your share is in your wallet, and goes to your bank as soon as your payout details are confirmed.`, href: "/rep/earnings", entityType: "recorded_sale", entityId: sale.id });
  if (vendor.userId) await notifyUser({ userId: vendor.userId, type: "recorded_sale_approved_vendor", title: "KampusForce verified a rep's sale", body: `Operations verified a ${what} sale a campus rep recorded. ${naira(deal.vendorCommissionKobo)} commission was paid from your wallet. If it didn't happen, dispute it on your dashboard${deal.clawbackUntil ? ` by ${deal.clawbackUntil.toLocaleDateString("en-NG")}` : ""}.`, href: "/vendor", entityType: "recorded_sale", entityId: sale.id });
  return { id: sale.id, state: "verified" as const, dealId: deal.id, repCommissionKobo: deal.repCommissionKobo, platformFeeKobo: deal.platformFeeKobo, vendorCommissionKobo: deal.vendorCommissionKobo, paidOut };
}

/** The vendor can't cover the commission: the sale stays waiting, and the vendor is asked to add funds. */
async function walletShort(vendor: typeof vendors.$inferSelect, product: typeof products.$inferSelect, balanceKobo: number, neededKobo: number): Promise<never> {
  if (vendor.userId) await notifyUser({ userId: vendor.userId, type: "escrow_short_for_sale", title: "Add funds to pay a rep's commission", body: `A ${product.name} sale is ready to approve, but its ${naira(neededKobo)} commission is more than your wallet's ${naira(balanceKobo)}. Add funds so it can be paid.`, href: "/vendor", entityType: "vendor", entityId: vendor.id });
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: `The vendor's wallet has ${naira(balanceKobo)}, and this sale's commission is ${naira(neededKobo)}. The vendor has been asked to add funds; the sale stays waiting.` });
}

export async function rejectRecordedSale(input: { id: number; reviewerUserId: number; reason: string }) {
  const db = getDb();
  const updated = await db.update(recordedSales).set({ state: "rejected", reviewerUserId: input.reviewerUserId, reviewReason: input.reason, decidedAt: new Date() })
    .where(and(eq(recordedSales.id, input.id), eq(recordedSales.state, "waiting"))).returning();
  if (!updated.length) throw new TRPCError({ code: "CONFLICT", message: "This sale isn't waiting for verification any more. Refresh the list." });
  const sale = updated[0];
  await db.insert(auditLogs).values({ actorUserId: input.reviewerUserId, action: "recorded_sale.rejected", entityType: "recorded_sale", entityId: String(sale.id), metadataJson: { reason: input.reason } });
  const [rep] = await db.select({ userId: reps.userId }).from(reps).where(eq(reps.id, sale.repId)).limit(1);
  const [product] = await db.select({ name: products.name }).from(products).where(eq(products.id, sale.productId)).limit(1);
  const [vendor] = await db.select({ userId: vendors.userId }).from(vendors).where(eq(vendors.id, sale.vendorId)).limit(1);
  if (rep) await notifyUser({ userId: rep.userId, type: "recorded_sale_rejected", title: "A sale you recorded wasn't verified", body: `Operations couldn't verify the ${product?.name || "product"} sale: ${input.reason}`, href: "/rep/record", entityType: "recorded_sale", entityId: sale.id });
  if (vendor?.userId) await notifyUser({ userId: vendor.userId, type: "recorded_sale_rejected_vendor", title: "A rep's sale wasn't verified", body: `Operations rejected a ${product?.name || "product"} sale a campus rep recorded. Nothing was paid from your wallet.`, href: "/vendor", entityType: "recorded_sale", entityId: sale.id });
  return { id: sale.id, state: "rejected" as const };
}

const listColumns = {
  sale: recordedSales, productName: products.name, vendorName: vendors.companyName, repName: users.name, repCode: reps.code,
  dealState: deals.state, payoutId: deals.payoutId, vendorCommissionKobo: deals.vendorCommissionKobo, repCommissionKobo: deals.repCommissionKobo, platformFeeKobo: deals.platformFeeKobo, refundUntil: deals.clawbackUntil,
};

function recordedSalesQuery() {
  return getDb().select(listColumns).from(recordedSales)
    .innerJoin(products, eq(products.id, recordedSales.productId)).innerJoin(vendors, eq(vendors.id, recordedSales.vendorId))
    .innerJoin(reps, eq(reps.id, recordedSales.repId)).innerJoin(users, eq(users.id, reps.userId)).leftJoin(deals, eq(deals.id, recordedSales.dealId));
}

/** Adds the commission split: the actual one once a sale is verified, otherwise what the current terms would pay. */
async function withSplit<T extends { sale: typeof recordedSales.$inferSelect; vendorCommissionKobo: number | null; repCommissionKobo: number | null; platformFeeKobo: number | null }>(rows: T[]) {
  const productIds = [...new Set(rows.map((row) => row.sale.productId))];
  const rules = productIds.length ? await getDb().select().from(commissionRules)
    .where(and(inArray(commissionRules.productId, productIds), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.id)) : [];
  return rows.map((row) => {
    const rule = rules.find((candidate) => candidate.productId === row.sale.productId);
    const expected = row.repCommissionKobo === null ? expectedSplit(rule, row.sale.amountKobo, row.sale.quantity) : null;
    return {
      ...row,
      commission: rule ? { basis: rule.basis, pctBps: rule.pctBps, flatAmountKobo: rule.flatAmountKobo, triggerEvent: rule.triggerEvent } : null,
      split: row.repCommissionKobo !== null
        ? { vendorCommissionKobo: row.vendorCommissionKobo!, repCommissionKobo: row.repCommissionKobo, platformFeeKobo: row.platformFeeKobo!, final: true }
        : expected ? { ...expected, final: false } : null,
    };
  });
}

export async function repRecordedSales(repId: number) {
  return withSplit(await recordedSalesQuery().where(eq(recordedSales.repId, repId)).orderBy(desc(recordedSales.createdAt)).limit(100));
}

export async function salesToVerify() {
  const rows = await withSplit(await recordedSalesQuery().where(eq(recordedSales.state, "waiting")).orderBy(desc(recordedSales.createdAt)).limit(100));
  // Each vendor's wallet, so Operations sees before approving whether the commission can be paid.
  const vendorIds = [...new Set(rows.map((row) => row.sale.vendorId))];
  const wallets = vendorIds.length ? await getDb().select().from(escrowWallets).where(inArray(escrowWallets.vendorId, vendorIds)) : [];
  const stock = await stockFor(rows.map((row) => row.sale.productId));
  return rows.map((row) => ({ ...row, vendorWalletKobo: wallets.find((wallet) => wallet.vendorId === row.sale.vendorId)?.balanceKobo ?? 0, stockQuantity: stock.get(row.sale.productId) ?? null }));
}

async function stockFor(productIds: number[]) {
  const ids = [...new Set(productIds)];
  const rows = ids.length ? await getDb().select({ id: products.id, stock: products.stockQuantity }).from(products).where(inArray(products.id, ids)) : [];
  return new Map(rows.map((row) => [row.id, row.stock]));
}

/** Every sale reps recorded for this vendor, from the moment it's recorded, with what it cost the vendor once approved. */
export async function vendorRecordedSales(vendorId: number) {
  const rows = await withSplit(await recordedSalesQuery().where(eq(recordedSales.vendorId, vendorId)).orderBy(desc(recordedSales.createdAt)).limit(200));
  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    // Only a sale Operations approved can be disputed by the vendor (one the vendor reported, they refund through their system), within its refund period.
    canDispute: row.sale.state === "verified" && row.sale.verifiedBy === "operations" && Boolean(row.dealState && ["pending", "confirmed", "payable", "paid"].includes(row.dealState))
      && (!row.refundUntil || row.refundUntil.getTime() > now),
  }));
}

/** Sales Operations verified for this vendor without the vendor reporting them, so the vendor can check and dispute. */
export function vendorOpsVerifiedSales(vendorId: number) {
  return recordedSalesQuery().where(and(eq(recordedSales.vendorId, vendorId), eq(recordedSales.verifiedBy, "operations"))).orderBy(desc(recordedSales.decidedAt)).limit(100);
}

export async function vendorDisputeRecordedSale(input: { vendorId: number; actorUserId: number; id: number; reason: string }) {
  const db = getDb();
  const [sale] = await db.select().from(recordedSales).where(and(eq(recordedSales.id, input.id), eq(recordedSales.vendorId, input.vendorId), eq(recordedSales.verifiedBy, "operations"))).limit(1);
  if (!sale?.dealId) throw new TRPCError({ code: "NOT_FOUND", message: "Sale not found." });
  const [deal] = await db.select().from(deals).where(eq(deals.id, sale.dealId)).limit(1);
  if (deal?.clawbackUntil && deal.clawbackUntil.getTime() <= Date.now()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `The refund period for this sale ended on ${deal.clawbackUntil.toLocaleDateString("en-NG")}, so it can't be disputed.` });
  // Same hold-and-review process as any commission dispute: the sale is held and Operations decides. If Operations
  // agrees with the vendor, the commission goes back to the vendor's wallet.
  const result = await openDealDispute({ dealId: sale.dealId, repId: sale.repId, actorUserId: input.actorUserId, reasonCode: "vendor_disputes_verified_sale", evidence: input.reason });
  const [rep] = await db.select({ userId: reps.userId }).from(reps).where(eq(reps.id, sale.repId)).limit(1);
  const [product] = await db.select({ name: products.name }).from(products).where(eq(products.id, sale.productId)).limit(1);
  if (rep) await notifyUser({ userId: rep.userId, type: "recorded_sale_disputed", title: "A vendor disputed one of your sales", body: `The vendor says the ${product?.name || "product"} sale didn't happen. Operations is reviewing it; the commission is on hold until they decide.`, href: "/rep/earnings", entityType: "recorded_sale", entityId: sale.id });
  return result;
}

/** The vendor's wallet history: money added, commission paid out for sales, and commission returned. */
export async function vendorWalletHistory(vendorId: number) {
  const db = getDb();
  const topups = await db.select().from(escrowTopups).where(and(eq(escrowTopups.vendorId, vendorId), eq(escrowTopups.state, "paid"))).orderBy(desc(escrowTopups.paidAt)).limit(100);
  const entries = await db.select({ entry: ledgerEntries, productName: products.name, repCode: reps.code }).from(ledgerEntries)
    .innerJoin(deals, eq(deals.id, ledgerEntries.dealId)).innerJoin(products, eq(products.id, deals.productId)).innerJoin(reps, eq(reps.id, deals.repId))
    .where(and(eq(ledgerEntries.account, "vendor_escrow"), eq(deals.vendorId, vendorId))).orderBy(desc(ledgerEntries.createdAt)).limit(200);
  const lines = [
    ...topups.map((topup) => ({ at: topup.paidAt || topup.createdAt, kind: "funds_added" as const, amountKobo: topup.amountKobo, detail: `Added through Paystack (${topup.reference})`, dealId: null as number | null })),
    ...entries.map(({ entry, productName, repCode }) => ({
      at: entry.createdAt,
      kind: entry.direction === "debit" ? "commission_paid" as const : "commission_returned" as const,
      amountKobo: entry.direction === "debit" ? -entry.amountKobo : entry.amountKobo,
      detail: `${productName} · rep ${repCode} · sale #${entry.dealId}`,
      dealId: entry.dealId,
    })),
  ];
  return lines.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 200);
}
