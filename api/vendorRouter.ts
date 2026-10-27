import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  attributionRecords,
  commissionRuleDrafts,
  commissionRules,
  deals,
  escrowWallets,
  products,
  reps,
  supportResolutionMacros,
  supportTickets,
  vendors,
  vendorIngestionRetries,
} from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { getDb } from "./queries/connection";
import { ingestWithDurableRetry } from "./services/ingestionRetries";
import { activeWebhookCredential, rotateVendorWebhookCredential } from "./services/webhookCredentials";
import { calculateRuleDryRun, publishRuleDraft } from "./services/rules";
import { escalateSupportTicket, isSlaBreached, resolveSupportTicket, syncSlaBreaches, ticketEvents } from "./services/support";

async function currentVendor(userId: number) {
  const [vendor] = await getDb().select().from(vendors).where(eq(vendors.userId, userId)).limit(1);
  if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor profile not found" });
  return vendor;
}

const ruleInput = z.object({
  productId: z.number().int().positive(),
  basis: z.enum(["flat", "pct"]),
  pctBps: z.number().int().min(1).max(10000).optional(),
  flatAmountKobo: z.number().int().min(1).max(1000000000).optional(),
  triggerEvent: z.enum(["signup", "kyc_complete", "funded", "first_transaction", "renewal"]),
  recurrenceMonths: z.number().int().min(1).max(12),
  confirmDays: z.number().int().min(0).max(90),
  clawbackDays: z.number().int().min(0).max(365),
  activationCapPerRepDay: z.number().int().min(1).max(1000).optional(),
  sampleAmountKobo: z.number().int().positive().max(100000000000).optional(),
});

export const vendorRouter = createRouter({
  overview: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    await syncSlaBreaches(vendor.id);
    const catalog = await getDb().select({ product: products, rule: commissionRules, vendorQualityScore: vendors.qualityScore }).from(products)
      .innerJoin(commissionRules, eq(commissionRules.productId, products.id))
      .innerJoin(vendors, eq(products.vendorId, vendors.id))
      .where(and(eq(products.vendorId, vendor.id), isNull(commissionRules.supersededAt)))
      .orderBy(products.id);
    const ruleHistory = await getDb().select({ rule: commissionRules, productName: products.name }).from(commissionRules)
      .innerJoin(products, eq(commissionRules.productId, products.id))
      .where(eq(products.vendorId, vendor.id)).orderBy(desc(commissionRules.publishedAt)).limit(30);
    const drafts = await getDb().select().from(commissionRuleDrafts).where(eq(commissionRuleDrafts.vendorId, vendor.id)).orderBy(desc(commissionRuleDrafts.createdAt)).limit(12);
    const [wallet] = await getDb().select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
    const funnel = await getDb().select().from(deals).where(eq(deals.vendorId, vendor.id)).orderBy(desc(deals.createdAt));
    const attributions = await getDb().select({ id: attributionRecords.id, productId: attributionRecords.productId }).from(attributionRecords).where(eq(attributionRecords.vendorId, vendor.id));
    const supportCases = await getDb().select({ ticket: supportTickets, repCode: reps.code }).from(supportTickets)
      .innerJoin(reps, eq(supportTickets.repId, reps.id)).where(eq(supportTickets.vendorId, vendor.id)).orderBy(desc(supportTickets.createdAt)).limit(40);
    const macros = await getDb().select().from(supportResolutionMacros).where(and(eq(supportResolutionMacros.vendorId, vendor.id), eq(supportResolutionMacros.active, true))).orderBy(desc(supportResolutionMacros.approvedAt));
    const credential = await activeWebhookCredential(vendor.id);
    const ingestionRetryRows = await getDb().select({ id: vendorIngestionRetries.id, state: vendorIngestionRetries.state, nextRetryAt: vendorIngestionRetries.nextRetryAt }).from(vendorIngestionRetries).where(eq(vendorIngestionRetries.vendorId, vendor.id));
    const activeDeals = funnel.filter((deal) => !["void", "clawed_back", "failed"].includes(deal.state));
    const funnelMetrics = {
      attributed: attributions.length,
      activated: activeDeals.length,
      pending: activeDeals.filter((deal) => deal.state === "pending").length,
      confirmed: activeDeals.filter((deal) => ["confirmed", "payable", "paid", "disputed"].includes(deal.state)).length,
      paid: activeDeals.filter((deal) => deal.state === "paid").length,
      activationRate: attributions.length ? Math.round((activeDeals.length / attributions.length) * 100) : 0,
      openSupport: supportCases.filter(({ ticket }) => !["resolved", "closed"].includes(ticket.state)).length,
      breachedSupport: supportCases.filter(({ ticket }) => isSlaBreached(ticket)).length,
      csatRatings: supportCases.filter(({ ticket }) => ticket.csat).length,
    };
    return {
      vendor: { id: vendor.id, companyName: vendor.companyName, webhookKey: vendor.webhookKey, webhookKeyVersion: credential?.keyVersion || 1, status: vendor.status, supportSlaHours: vendor.supportSlaHours, qualityScore: vendor.qualityScore },
      ingestion: {
        retryScheduled: ingestionRetryRows.filter((retry) => retry.state === "retry_scheduled").length,
        deadLetter: ingestionRetryRows.filter((retry) => retry.state === "dead_letter").length,
        resolved: ingestionRetryRows.filter((retry) => retry.state === "resolved").length,
        payloadRetentionDays: 30,
      },
      catalog,
      ruleHistory,
      drafts,
      wallet,
      funnel,
      funnelMetrics,
      supportCases: supportCases.map((row) => ({ ...row, slaBreached: isSlaBreached(row.ticket) })),
      macros,
    };
  }),
  topupEscrow: authedQuery.input(z.object({ amountKobo: z.number().int().min(10000).max(1000000000) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    const [wallet] = await getDb().select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
    if (!wallet) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow wallet not found" });
    await getDb().update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + input.amountKobo, updatedAt: new Date() }).where(eq(escrowWallets.vendorId, vendor.id));
    return { balanceKobo: wallet.balanceKobo + input.amountKobo, provider: "paystack_sandbox", status: "funded" };
  }),
  ruleDryRun: authedQuery.input(ruleInput).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    const [product] = await getDb().select().from(products).where(and(eq(products.id, input.productId), eq(products.vendorId, vendor.id))).limit(1);
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor product not found" });
    const sampleAmountKobo = input.basis === "pct" ? input.sampleAmountKobo || product.priceKobo : null;
    let economics: ReturnType<typeof calculateRuleDryRun>;
    try {
      economics = calculateRuleDryRun(input, sampleAmountKobo);
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid commission rule" });
    }
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const [{ id }] = await getDb().insert(commissionRuleDrafts).values({
      productId: product.id,
      vendorId: vendor.id,
      createdByUserId: ctx.user.id,
      basis: economics.basis,
      pctBps: economics.pctBps,
      flatAmountKobo: economics.flatAmountKobo,
      triggerEvent: economics.triggerEvent,
      recurrenceMonths: economics.recurrenceMonths,
      confirmDays: economics.confirmDays,
      clawbackDays: economics.clawbackDays,
      activationCapPerRepDay: economics.activationCapPerRepDay,
      sampleAmountKobo: economics.sampleAmountKobo,
      vendorCommissionKobo: economics.vendorCommissionKobo,
      repCommissionKobo: economics.repCommissionKobo,
      platformFeeKobo: economics.platformFeeKobo,
      expiresAt,
    }).returning({ id: commissionRuleDrafts.id });
    const [current] = await getDb().select().from(commissionRules).where(and(eq(commissionRules.productId, product.id), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.version)).limit(1);
    return { draftId: id, productId: product.id, productName: product.name, currentVersion: current?.version || 0, nextVersion: (current?.version || 0) + 1, expiresAt, ...economics };
  }),
  publishRule: authedQuery.input(z.object({ draftId: z.number().int().positive(), confirmation: z.literal("PUBLISH") })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    return publishRuleDraft(ctx.user.id, vendor.id, input.draftId);
  }),
  updateSupportSla: authedQuery.input(z.object({ hours: z.number().int().min(1).max(168) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    await getDb().update(vendors).set({ supportSlaHours: input.hours }).where(eq(vendors.id, vendor.id));
    return { vendorId: vendor.id, supportSlaHours: input.hours, appliesTo: "new_tickets_only" };
  }),
  saveResolutionMacro: authedQuery.input(z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    const [{ id }] = await getDb().insert(supportResolutionMacros).values({ vendorId: vendor.id, title: input.title, body: input.body, approvedByUserId: ctx.user.id }).returning({ id: supportResolutionMacros.id });
    return { macroId: id, approved: true };
  }),
  escalateSupport: authedQuery.input(z.object({ ticketId: z.number().int().positive(), note: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    return escalateSupportTicket({ ticketId: input.ticketId, actorUserId: ctx.user.id, actor: "vendor", vendorId: vendor.id, note: input.note });
  }),
  resolveSupport: authedQuery.input(z.object({ ticketId: z.number().int().positive(), resolution: z.string().trim().min(10).max(2000), macroId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    return resolveSupportTicket({ ticketId: input.ticketId, actorUserId: ctx.user.id, actor: "vendor", vendorId: vendor.id, resolution: input.resolution, macroId: input.macroId });
  }),
  supportTimeline: authedQuery.input(z.object({ ticketId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    const [ticket] = await getDb().select().from(supportTickets).where(and(eq(supportTickets.id, input.ticketId), eq(supportTickets.vendorId, vendor.id))).limit(1);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found" });
    return { ticket, events: await ticketEvents(ticket.id) };
  }),
  rotateWebhookCredential: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    return rotateVendorWebhookCredential(ctx.user.id, vendor.id);
  }),
  simulateEvent: authedQuery.input(z.object({ productRef: z.string(), type: z.enum(["account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]), customerPhone: z.string(), amountKobo: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["vendor"]);
    const vendor = await currentVendor(ctx.user.id);
    return ingestWithDurableRetry(vendor.webhookKey, { event_id: crypto.randomUUID(), type: input.type, occurred_at: new Date().toISOString(), customer: { phone: input.customerPhone, customer_ref: `sandbox-${input.customerPhone}` }, product_ref: input.productRef, amount_kobo: input.amountKobo, meta: { channel: "vendor_portal_sandbox" } });
  }),
});
