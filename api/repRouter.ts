import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  assistedSessions,
  campusLeadAssignments,
  campusLeadOverrides,
  campusRecruitments,
  campuses,
  commissionRules,
  dealStateHistory,
  deals,
  payouts,
  products,
  reps,
  supportTickets,
  users,
  vendors,
} from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { ensureAttribution } from "./services/attribution";
import { getDb } from "./queries/connection";
import { normalizePhone } from "./services/security";
import { createSupportTicket, escalateSupportTicket, isSlaBreached, rateSupportTicket, syncSlaBreaches, ticketEvents } from "./services/support";
import { createInvitationToken, hashInvitationToken, revokeRecruitment } from "./services/recruiting";
import { listRepFraudCases, requestFraudAppeal } from "./services/fraud";
import { openDealDispute } from "./services/ledger";

async function currentRep(userId: number) {
  const [rep] = await getDb().select().from(reps).where(eq(reps.userId, userId)).limit(1);
  if (!rep) throw new TRPCError({ code: "NOT_FOUND", message: "Rep profile not found" });
  return rep;
}

async function repDeals(repId: number) {
  return getDb().select({ deal: deals, productName: products.name, vendorName: vendors.companyName }).from(deals)
    .innerJoin(products, eq(deals.productId, products.id)).innerJoin(vendors, eq(deals.vendorId, vendors.id))
    .where(eq(deals.repId, repId)).orderBy(desc(deals.createdAt));
}

async function canAccessTicket(rep: typeof reps.$inferSelect, ticket: typeof supportTickets.$inferSelect) {
  if (ticket.repId === rep.id) return true;
  if (rep.tier !== "campus_lead") return false;
  const [assignment] = await getDb().select().from(campusLeadAssignments)
    .where(and(eq(campusLeadAssignments.leadRepId, rep.id), eq(campusLeadAssignments.repId, ticket.repId), isNull(campusLeadAssignments.revokedAt))).limit(1);
  return Boolean(assignment);
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
    return getDb().select({ product: products, rule: commissionRules, vendorName: vendors.companyName, vendorQualityScore: vendors.qualityScore }).from(products)
      .innerJoin(vendors, eq(products.vendorId, vendors.id)).innerJoin(commissionRules, eq(commissionRules.productId, products.id))
      .where(and(eq(products.status, "active"), isNull(commissionRules.supersededAt)));
  }),
  dashboard: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const rows = await repDeals(rep.id);
    const paid = await getDb().select().from(payouts).where(eq(payouts.repId, rep.id)).orderBy(desc(payouts.createdAt));
    const overrides = rep.tier === "campus_lead" ? await getDb().select().from(campusLeadOverrides).where(eq(campusLeadOverrides.leadRepId, rep.id)) : [];
    return {
      metrics: {
        activations: rows.length,
        pendingKobo: rows.filter((r) => ["pending", "confirmed"].includes(r.deal.state)).reduce((s, r) => s + r.deal.repCommissionKobo, 0),
        payableKobo: rows.filter((r) => r.deal.state === "payable").reduce((s, r) => s + r.deal.repCommissionKobo, 0),
        paidKobo: paid.filter((payout) => payout.state === "paid").reduce((s, p) => s + p.amountNetKobo, 0),
        overridePayableKobo: overrides.filter((override) => override.state === "accrued").reduce((sum, override) => sum + override.overrideKobo, 0),
        overridePaidKobo: overrides.filter((override) => override.state === "paid").reduce((sum, override) => sum + override.overrideKobo, 0),
      },
      recent: rows.slice(0, 6),
      payouts: paid.slice(0, 5),
    };
  }),
  team: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const lead = await currentRep(ctx.user.id);
    if (lead.tier !== "campus_lead") return { isLead: false as const, lead, members: [], overrides: [], recruitments: [] };
    const assignments = await getDb().select({ assignment: campusLeadAssignments, member: reps, user: users }).from(campusLeadAssignments)
      .innerJoin(reps, eq(campusLeadAssignments.repId, reps.id)).innerJoin(users, eq(reps.userId, users.id))
      .where(and(eq(campusLeadAssignments.leadRepId, lead.id), isNull(campusLeadAssignments.revokedAt))).orderBy(desc(campusLeadAssignments.assignedAt));
    const memberIds = assignments.map((row) => row.member.id);
    const teamDeals = memberIds.length ? await getDb().select().from(deals).where(inArray(deals.repId, memberIds)) : [];
    const overrides = await getDb().select({ override: campusLeadOverrides, sourceRepCode: reps.code }).from(campusLeadOverrides)
      .innerJoin(reps, eq(campusLeadOverrides.sourceRepId, reps.id)).where(eq(campusLeadOverrides.leadRepId, lead.id)).orderBy(desc(campusLeadOverrides.createdAt));
    const recruitments = await getDb().select().from(campusRecruitments).where(eq(campusRecruitments.leadRepId, lead.id)).orderBy(desc(campusRecruitments.invitedAt)).limit(30);
    return {
      isLead: true as const,
      lead,
      members: assignments.map((row) => ({
        ...row,
        activations: teamDeals.filter((deal) => deal.repId === row.member.id && !["void", "clawed_back", "failed"].includes(deal.state)).length,
        confirmedKobo: teamDeals.filter((deal) => deal.repId === row.member.id && ["confirmed", "payable", "paid"].includes(deal.state)).reduce((sum, deal) => sum + deal.repCommissionKobo, 0),
      })),
      overrides,
      recruitments,
    };
  }),
  recruitRep: authedQuery.input(z.object({ name: z.string().trim().min(3).max(160), phone: z.string().min(7).max(20), note: z.string().trim().max(300).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const lead = await currentRep(ctx.user.id);
    if (lead.tier !== "campus_lead" || lead.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Only an active campus lead can own recruiting invitations" });
    const phoneE164 = normalizePhone(input.phone);
    const [existing] = await getDb().select().from(campusRecruitments).where(and(eq(campusRecruitments.leadRepId, lead.id), eq(campusRecruitments.phoneE164, phoneE164), eq(campusRecruitments.status, "invited"))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This recruit already has an open invitation" });
    const invitationToken = createInvitationToken();
    const [{ id }] = await getDb().insert(campusRecruitments).values({ leadRepId: lead.id, campusId: lead.campusId, name: input.name, phoneE164, note: input.note || null, tokenHash: hashInvitationToken(invitationToken), expiresAt: new Date(Date.now() + 7 * 86_400_000) }).returning({ id: campusRecruitments.id });
    return { recruitmentId: id, status: "invited" as const, acceptancePath: `/recruit/accept?token=${encodeURIComponent(invitationToken)}`, nextStep: "recruit_phone_verified_acceptance" };
  }),
  revokeRecruitment: authedQuery.input(z.object({ recruitmentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const lead = await currentRep(ctx.user.id);
    if (lead.tier !== "campus_lead" || lead.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Only an active campus lead can revoke recruiting invitations" });
    return revokeRecruitment({ recruitmentId: input.recruitmentId, actorUserId: ctx.user.id, leadRepId: lead.id });
  }),
  assignTeamMember: authedQuery.input(z.object({ repId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const lead = await currentRep(ctx.user.id);
    if (lead.tier !== "campus_lead" || lead.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Only an active campus lead can assign team members" });
    const [member] = await getDb().select().from(reps).where(and(eq(reps.id, input.repId), eq(reps.campusId, lead.campusId), eq(reps.status, "active"))).limit(1);
    if (!member || member.id === lead.id || member.tier === "campus_lead") throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active non-lead rep on your campus" });
    const [existing] = await getDb().select().from(campusLeadAssignments).where(eq(campusLeadAssignments.repId, member.id)).limit(1);
    if (existing && !existing.revokedAt) throw new TRPCError({ code: "CONFLICT", message: "This rep already belongs to a campus team" });
    if (existing) await getDb().update(campusLeadAssignments).set({ leadRepId: lead.id, campusId: lead.campusId, assignedByUserId: ctx.user.id, assignedAt: new Date(), revokedAt: null }).where(eq(campusLeadAssignments.id, existing.id));
    else await getDb().insert(campusLeadAssignments).values({ leadRepId: lead.id, repId: member.id, campusId: lead.campusId, assignedByUserId: ctx.user.id });
    return { repId: member.id, leadRepId: lead.id, assigned: true };
  }),
  share: authedQuery.input(z.object({ productId: z.number().int().positive(), customerPhone: z.string().optional(), source: z.enum(["link", "qr"]).default("link") })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    if (rep.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Operations must activate your rep profile before you can share attribution links" });
    const [product] = await getDb().select().from(products).where(and(eq(products.id, input.productId), eq(products.status, "active"))).limit(1);
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Active product not found" });
    let attributed = false;
    if (input.customerPhone) attributed = (await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: input.customerPhone, source: input.source, actorUserId: ctx.user.id })).created;
    const origin = ctx.req.headers.get("origin") || `${ctx.req.headers.get("x-forwarded-proto") || "http"}://${ctx.req.headers.get("host")}`;
    // Attribution is already persisted above. Never put customer identifiers in a
    // copied URL, browser history, referrer, screenshot, QR code, or access log.
    const url = `${origin}/l/${rep.code}?p=${encodeURIComponent(product.vendorRef)}`;
    const qr = await QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: "#102a43", light: "#fffdf7" } });
    const text = `I can help you activate ${product.name} at the vendor’s listed price. Use my KampusForce link: ${url}`;
    return { url, qr, text, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`, attributed };
  }),
  assistedStart: authedQuery.input(z.object({ productId: z.number().int().positive(), customerPhone: z.string() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    if (rep.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Operations must activate your rep profile before assisted onboarding" });
    const { attribution } = await ensureAttribution({ repId: rep.id, productId: input.productId, customerPhone: input.customerPhone, source: "assisted", actorUserId: ctx.user.id });
    const [{ id }] = await getDb().insert(assistedSessions).values({ repId: rep.id, productId: input.productId, customerPhoneHash: attribution.customerPhoneHash, currentStep: 1, consentAt: new Date() }).returning({ id: assistedSessions.id });
    return { sessionId: id, attributionId: attribution.id };
  }),
  assistedAdvance: authedQuery.input(z.object({ sessionId: z.number().int().positive(), step: z.number().int().min(1).max(6) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [session] = await getDb().select().from(assistedSessions).where(and(eq(assistedSessions.id, input.sessionId), eq(assistedSessions.repId, rep.id))).limit(1);
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Assisted session not found" });
    if (input.step === session.currentStep) return { sessionId: session.id, currentStep: session.currentStep, status: session.status };
    if (session.status !== "active" || input.step !== session.currentStep + 1) {
      throw new TRPCError({ code: "CONFLICT", message: "Assisted onboarding must advance one step at a time and cannot reopen a completed session" });
    }
    const completed = input.step === 6;
    const [updated] = await getDb().update(assistedSessions).set({
      currentStep: input.step,
      status: completed ? "completed" : "active",
      updatedAt: new Date(),
    }).where(and(
      eq(assistedSessions.id, session.id),
      eq(assistedSessions.currentStep, session.currentStep),
      eq(assistedSessions.status, "active"),
    )).returning({ id: assistedSessions.id });
    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "This assisted session changed in another request. Refresh before continuing." });
    return { sessionId: session.id, currentStep: input.step, status: completed ? "completed" : "active" };
  }),
  earnings: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const rows = await repDeals(rep.id);
    const history = await getDb().select({ history: dealStateHistory }).from(dealStateHistory).innerJoin(deals, eq(dealStateHistory.dealId, deals.id)).where(eq(deals.repId, rep.id)).orderBy(desc(dealStateHistory.createdAt)).limit(80);
    const repPayouts = await getDb().select().from(payouts).where(eq(payouts.repId, rep.id)).orderBy(desc(payouts.createdAt));
    const overrides = rep.tier === "campus_lead" ? await getDb().select({ override: campusLeadOverrides, sourceRepCode: reps.code }).from(campusLeadOverrides).innerJoin(reps, eq(campusLeadOverrides.sourceRepId, reps.id)).where(eq(campusLeadOverrides.leadRepId, rep.id)).orderBy(desc(campusLeadOverrides.createdAt)) : [];
    return { deals: rows, history: history.map((h) => h.history), payouts: repPayouts, overrides };
  }),
  fraudCases: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    return listRepFraudCases(rep.id);
  }),
  appealFraudCase: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    note: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    return requestFraudAppeal({ ...input, repId: rep.id, actorUserId: ctx.user.id });
  }),
  support: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    await syncSlaBreaches();
    const own = await getDb().select({ ticket: supportTickets, vendorName: vendors.companyName, repCode: reps.code }).from(supportTickets)
      .innerJoin(vendors, eq(supportTickets.vendorId, vendors.id)).innerJoin(reps, eq(supportTickets.repId, reps.id)).where(eq(supportTickets.repId, rep.id));
    let rows = own;
    if (rep.tier === "campus_lead") {
      const assignments = await getDb().select({ repId: campusLeadAssignments.repId }).from(campusLeadAssignments).where(and(eq(campusLeadAssignments.leadRepId, rep.id), isNull(campusLeadAssignments.revokedAt)));
      const ids = assignments.map((row) => row.repId).filter((id) => id !== rep.id);
      if (ids.length) {
        const teamRows = await getDb().select({ ticket: supportTickets, vendorName: vendors.companyName, repCode: reps.code }).from(supportTickets)
          .innerJoin(vendors, eq(supportTickets.vendorId, vendors.id)).innerJoin(reps, eq(supportTickets.repId, reps.id)).where(inArray(supportTickets.repId, ids));
        rows = [...own, ...teamRows];
      }
    }
    rows.sort((a, b) => b.ticket.createdAt.getTime() - a.ticket.createdAt.getTime());
    return { isLead: rep.tier === "campus_lead", cases: rows.map((row) => ({ ...row, slaBreached: isSlaBreached(row.ticket) })) };
  }),
  createTicket: authedQuery.input(z.object({
    productId: z.number().int().positive().optional(), dealId: z.number().int().positive().optional(), customerPhone: z.string().max(20).optional(),
    category: z.enum(["activation", "commission", "payout", "vendor_product", "refund", "other"]),
    subject: z.string().trim().min(5).max(180), description: z.string().trim().min(10).max(2000), priority: z.enum(["normal", "urgent"]).default("normal"),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    return createSupportTicket({ ...input, actorUserId: ctx.user.id, repId: rep.id });
  }),
  escalateTicket: authedQuery.input(z.object({ ticketId: z.number().int().positive(), target: z.enum(["campus_lead", "vendor"]).default("vendor"), note: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [ticket] = await getDb().select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1);
    if (!ticket || !(await canAccessTicket(rep, ticket))) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found" });
    const actor = ticket.repId === rep.id ? "rep" : "lead";
    return escalateSupportTicket({ ticketId: ticket.id, actorUserId: ctx.user.id, actor, repId: rep.id, target: input.target, note: input.note });
  }),
  rateTicket: authedQuery.input(z.object({ ticketId: z.number().int().positive(), csat: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    return rateSupportTicket({ ticketId: input.ticketId, actorUserId: ctx.user.id, repId: rep.id, csat: input.csat, comment: input.comment });
  }),
  supportTimeline: authedQuery.input(z.object({ ticketId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    const [ticket] = await getDb().select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1);
    if (!ticket || !(await canAccessTicket(rep, ticket))) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found" });
    return { ticket, events: await ticketEvents(ticket.id) };
  }),
  openDispute: authedQuery.input(z.object({ dealId: z.number().int().positive(), reasonCode: z.string().min(3).max(80), evidence: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    const rep = await currentRep(ctx.user.id);
    return openDealDispute({ ...input, repId: rep.id, actorUserId: ctx.user.id });
  }),
});
