import { and, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { assistedSessions, campuses, commissionRules, dealStateHistory, deals, disputes, payouts, products, reps, vendors } from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { ensureAttribution } from "./services/attribution";
import { getDb } from "./queries/connection";

async function currentRep(userId: number) {
  const [rep] = await getDb().select().from(reps).where(eq(reps.userId, userId)).limit(1);
  if (!rep) throw new TRPCError({ code: "NOT_FOUND", message: "Rep profile not found" });
  return rep;
}

async function repDeals(repId: number) {
  const rows = await getDb().select({ deal: deals, productName: products.name, vendorName: vendors.companyName }).from(deals).innerJoin(products, eq(deals.productId, products.id)).innerJoin(vendors, eq(deals.vendorId, vendors.id)).where(eq(deals.repId, repId)).orderBy(desc(deals.createdAt));
  return rows;
}

export const repRouter = createRouter({
  me: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [campus] = await getDb().select().from(campuses).where(eq(campuses.id, rep.campusId)).limit(1);
    return { user: ctx.user, rep, campus };
  }),
  catalog: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep", "vendor", "ops"]);
    return getDb().select({ product: products, rule: commissionRules, vendorName: vendors.companyName }).from(products).innerJoin(vendors, eq(products.vendorId, vendors.id)).innerJoin(commissionRules, eq(commissionRules.productId, products.id)).where(and(eq(products.status, "active"), eq(commissionRules.version, 1)));
  }),
  dashboard: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const rows = await repDeals(rep.id);
    const paid = await getDb().select().from(payouts).where(eq(payouts.repId, rep.id)).orderBy(desc(payouts.createdAt));
    return {
      metrics: {
        activations: rows.length,
        pendingKobo: rows.filter((r) => ["pending", "confirmed"].includes(r.deal.state)).reduce((s, r) => s + r.deal.repCommissionKobo, 0),
        payableKobo: rows.filter((r) => r.deal.state === "payable").reduce((s, r) => s + r.deal.repCommissionKobo, 0),
        paidKobo: paid.reduce((s, p) => s + p.amountNetKobo, 0),
      },
      recent: rows.slice(0, 6),
      payouts: paid.slice(0, 5),
    };
  }),
  share: authedQuery.input(z.object({ productId: z.number().int().positive(), customerPhone: z.string().optional(), source: z.enum(["link", "qr"]).default("link") })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [product] = await getDb().select().from(products).where(eq(products.id, input.productId)).limit(1);
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    let attributed = false;
    if (input.customerPhone) attributed = (await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: input.customerPhone, source: input.source, actorUserId: ctx.user.id })).created;
    const origin = ctx.req.headers.get("origin") || `${ctx.req.headers.get("x-forwarded-proto") || "http"}://${ctx.req.headers.get("host")}`;
    const url = `${origin}/l/${rep.code}?p=${encodeURIComponent(product.vendorRef)}${input.customerPhone ? `&phone=${encodeURIComponent(input.customerPhone)}` : ""}`;
    const qr = await QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: "#102a43", light: "#fffdf7" } });
    const text = `I can help you activate ${product.name} at the vendor’s listed price. Use my KampusForce link: ${url}`;
    return { url, qr, text, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`, attributed };
  }),
  assistedStart: authedQuery.input(z.object({ productId: z.number().int().positive(), customerPhone: z.string() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const { attribution } = await ensureAttribution({ repId: rep.id, productId: input.productId, customerPhone: input.customerPhone, source: "assisted", actorUserId: ctx.user.id });
    const [{ id }] = await getDb().insert(assistedSessions).values({ repId: rep.id, productId: input.productId, customerPhoneHash: attribution.customerPhoneHash, currentStep: 1, consentAt: new Date() }).$returningId();
    return { sessionId: id, attributionId: attribution.id };
  }),
  assistedAdvance: authedQuery.input(z.object({ sessionId: z.number().int().positive(), step: z.number().int().min(1).max(6) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [session] = await getDb().select().from(assistedSessions).where(and(eq(assistedSessions.id, input.sessionId), eq(assistedSessions.repId, rep.id))).limit(1);
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Assisted session not found" });
    const completed = input.step === 6;
    await getDb().update(assistedSessions).set({ currentStep: input.step, status: completed ? "completed" : "active" }).where(eq(assistedSessions.id, session.id));
    return { sessionId: session.id, currentStep: input.step, status: completed ? "completed" : "active" };
  }),
  earnings: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const rows = await repDeals(rep.id);
    const history = await getDb().select({ history: dealStateHistory }).from(dealStateHistory).innerJoin(deals, eq(dealStateHistory.dealId, deals.id)).where(eq(deals.repId, rep.id)).orderBy(desc(dealStateHistory.createdAt)).limit(80);
    const repPayouts = await getDb().select().from(payouts).where(eq(payouts.repId, rep.id)).orderBy(desc(payouts.createdAt));
    return { deals: rows, history: history.map((h) => h.history), payouts: repPayouts };
  }),
  openDispute: authedQuery.input(z.object({ dealId: z.number().int().positive(), reasonCode: z.string().min(3).max(80), evidence: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [deal] = await getDb().select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.repId, rep.id))).limit(1);
    if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
    await getDb().update(deals).set({ state: "disputed" }).where(eq(deals.id, deal.id));
    await getDb().insert(dealStateHistory).values({ dealId: deal.id, fromState: deal.state, toState: "disputed", actor: `rep:${rep.id}`, reason: input.reasonCode });
    const [{ id }] = await getDb().insert(disputes).values({ dealId: deal.id, openedBy: ctx.user.id, reasonCode: input.reasonCode, evidenceJson: { note: input.evidence || null } }).$returningId();
    return { disputeId: id, state: "open" };
  }),
});
