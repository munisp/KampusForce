import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { commissionRules, deals, escrowWallets, products, vendors } from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { getDb } from "./queries/connection";
import { ingestVendorEvent } from "./services/events";

async function currentVendor(userId: number) {
  const [vendor] = await getDb().select().from(vendors).where(eq(vendors.userId, userId)).limit(1);
  if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor profile not found" });
  return vendor;
}

export const vendorRouter = createRouter({
  overview: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    const catalog = await getDb().select({ product: products, rule: commissionRules }).from(products).innerJoin(commissionRules, eq(commissionRules.productId, products.id)).where(eq(products.vendorId, vendor.id));
    const [wallet] = await getDb().select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
    const funnel = await getDb().select().from(deals).where(eq(deals.vendorId, vendor.id)).orderBy(desc(deals.createdAt));
    return { vendor: { id: vendor.id, companyName: vendor.companyName, webhookKey: vendor.webhookKey, status: vendor.status }, catalog, wallet, funnel };
  }),
  topupEscrow: authedQuery.input(z.object({ amountKobo: z.number().int().min(10000).max(1000000000) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    const [wallet] = await getDb().select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
    if (!wallet) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow wallet not found" });
    await getDb().update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + input.amountKobo }).where(eq(escrowWallets.vendorId, vendor.id));
    return { balanceKobo: wallet.balanceKobo + input.amountKobo, provider: "paystack_sandbox", status: "funded" };
  }),
  simulateEvent: authedQuery.input(z.object({ productRef: z.string(), type: z.enum(["account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]), customerPhone: z.string(), amountKobo: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    return ingestVendorEvent(vendor.webhookKey, { event_id: crypto.randomUUID(), type: input.type, occurred_at: new Date().toISOString(), customer: { phone: input.customerPhone, customer_ref: `sandbox-${input.customerPhone}` }, product_ref: input.productRef, amount_kobo: input.amountKobo, meta: { channel: "vendor_portal_sandbox" } });
  }),
});
