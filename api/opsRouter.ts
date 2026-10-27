import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campusLeadOverrides,
  campusRecruitments,
  campuses,
  deals,
  disputes,
  payoutAttempts,
  payouts,
  products,
  reconciliationRuns,
  reps,
  supportTickets,
  users,
  vendorEvents,
  vendors,
} from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { getDb } from "./queries/connection";
import {
  confirmDueDeals,
  dispatchDuePayouts,
  reconcilePayoutBatch,
  recordSandboxPayoutOutcome,
  recoverFailedPayout,
  runPayoutBatch,
} from "./services/ledger";
import { campusLeadRankings, recalculateCampusLeadEligibility } from "./services/leadEligibility";
import { escalateSupportTicket, isSlaBreached, resolveSupportTicket, syncSlaBreaches, ticketEvents } from "./services/support";
import { activateRecruitment, revokeRecruitment } from "./services/recruiting";
import { recentJobRuns, runDueJobs } from "./services/jobs";
import { campusTelemetry } from "./services/telemetry";
import { acknowledgeOperationalIncident, listOperationalIncidents, monitorOperationalSignals, resolveOperationalIncident } from "./services/incidents";
import {
  closeBreachAssessment,
  createBreachAssessment,
  createDsarRequest,
  exportDsarEvidence,
  fulfilDsarRequest,
  listPrivacyDesk,
  recordBreachDecision,
  rejectDsarRequest,
  startBreachAssessment,
  startDsarReview,
  verifyDsarIdentity,
} from "./services/privacy";
import { isBreachTriageOverdue, isDsarOverdue } from "./services/privacyPolicy";

export const opsRouter = createRouter({
  overview: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    await syncSlaBreaches();
    const allDeals = await getDb().select({ deal: deals, productName: products.name, repCode: reps.code }).from(deals).innerJoin(products, eq(deals.productId, products.id)).innerJoin(reps, eq(deals.repId, reps.id)).orderBy(desc(deals.createdAt));
    const quarantine = await getDb().select().from(vendorEvents).where(eq(vendorEvents.status, "quarantined")).orderBy(desc(vendorEvents.receivedAt)).limit(30);
    const cases = await getDb().select({ dispute: disputes, openedBy: users.name }).from(disputes).innerJoin(users, eq(disputes.openedBy, users.id)).orderBy(desc(disputes.createdAt)).limit(30);
    const supportCases = await getDb().select({ ticket: supportTickets, repCode: reps.code, vendorName: vendors.companyName }).from(supportTickets)
      .innerJoin(reps, eq(supportTickets.repId, reps.id)).innerJoin(vendors, eq(supportTickets.vendorId, vendors.id)).orderBy(desc(supportTickets.createdAt)).limit(40);
    const overrides = await getDb().select({ override: campusLeadOverrides, leadCode: reps.code }).from(campusLeadOverrides)
      .innerJoin(reps, eq(campusLeadOverrides.leadRepId, reps.id)).orderBy(desc(campusLeadOverrides.createdAt)).limit(40);
    const leadRankings = await campusLeadRankings();
    const audit = await getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(30);
    const recruitments = await getDb().select({ recruitment: campusRecruitments, campusName: campuses.name, leadCode: reps.code }).from(campusRecruitments)
      .innerJoin(campuses, eq(campusRecruitments.campusId, campuses.id)).innerJoin(reps, eq(campusRecruitments.leadRepId, reps.id)).orderBy(desc(campusRecruitments.invitedAt)).limit(50);
    const jobs = await recentJobRuns();
    const telemetry = await campusTelemetry();
    const payoutRows = await getDb().select({ payout: payouts, repCode: reps.code }).from(payouts)
      .innerJoin(reps, eq(payouts.repId, reps.id)).orderBy(desc(payouts.createdAt));
    const attempts = await getDb().select().from(payoutAttempts).orderBy(desc(payoutAttempts.createdAt)).limit(100);
    const reconciliations = await getDb().select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.createdAt)).limit(50);
    const incidentData = await listOperationalIncidents();
    const privacy = await listPrivacyDesk();
    const rated = supportCases.filter(({ ticket }) => ticket.csat);
    return {
      metrics: {
        deals: allDeals.length,
        pending: allDeals.filter((d) => d.deal.state === "pending").length,
        payable: allDeals.filter((d) => d.deal.state === "payable").length,
        paid: allDeals.filter((d) => d.deal.state === "paid").length,
        queuedPayouts: payoutRows.filter(({ payout }) => payout.state === "queued").length,
        processingPayouts: payoutRows.filter(({ payout }) => payout.state === "processing").length,
        failedPayouts: payoutRows.filter(({ payout }) => ["failed", "held"].includes(payout.state)).length,
        openIncidents: incidentData.incidents.filter((incident) => incident.state !== "resolved").length,
        criticalIncidents: incidentData.incidents.filter((incident) => incident.state !== "resolved" && incident.severity === "critical").length,
        openDsars: privacy.requests.filter((request) => !["fulfilled", "rejected"].includes(request.state)).length,
        openBreaches: privacy.assessments.filter((assessment) => assessment.state !== "closed").length,
        overduePrivacy: privacy.requests.filter((request) => isDsarOverdue(request)).length + privacy.assessments.filter((assessment) => isBreachTriageOverdue(assessment)).length,
        quarantined: quarantine.length,
        openDisputes: cases.filter((c) => ["open", "reviewing"].includes(c.dispute.state)).length,
        openSupport: supportCases.filter(({ ticket }) => !["resolved", "closed"].includes(ticket.state)).length,
        breachedSupport: supportCases.filter(({ ticket }) => isSlaBreached(ticket)).length,
        averageCsat: rated.length ? Math.round((rated.reduce((sum, { ticket }) => sum + (ticket.csat || 0), 0) / rated.length) * 10) / 10 : null,
        overridesAccruedKobo: overrides.filter(({ override }) => override.state === "accrued").reduce((sum, { override }) => sum + override.overrideKobo, 0),
      },
      deals: allDeals.slice(0, 40),
      quarantine,
      disputes: cases,
      supportCases: supportCases.map((row) => ({ ...row, slaBreached: isSlaBreached(row.ticket) })),
      overrides,
      leadRankings,
      audit,
      recruitments,
      jobs,
      telemetry,
      payouts: payoutRows.slice(0, 50),
      payoutAttempts: attempts,
      reconciliations,
      incidents: incidentData.incidents,
      incidentEvents: incidentData.events,
      dsarRequests: privacy.requests.map((request) => ({ ...request, overdue: isDsarOverdue(request) })),
      dsarRequestEvents: privacy.requestEvents,
      breachAssessments: privacy.assessments.map((assessment) => ({ ...assessment, overdue: isBreachTriageOverdue(assessment) })),
      breachAssessmentEvents: privacy.assessmentEvents,
      privacyOwners: privacy.owners,
    };
  }),
  confirmSweep: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return confirmDueDeals(ctx.user.id);
  }),
  advanceWindows: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    await getDb().update(deals).set({ confirmAt: new Date(), updatedAt: new Date() }).where(eq(deals.state, "pending"));
    await getDb().insert(auditLogs).values({ actorUserId: ctx.user.id, action: "sandbox.confirmation_windows_advanced", entityType: "deal_batch", entityId: crypto.randomUUID() });
    return { advanced: true, mode: "sandbox_only" };
  }),
  payoutBatch: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return runPayoutBatch(ctx.user.id);
  }),
  dispatchPayouts: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return dispatchDuePayouts(ctx.user.id);
  }),
  payoutOutcome: authedQuery.input(z.object({
    payoutId: z.number().int().positive(),
    outcome: z.enum(["success", "failure"]),
    failureCode: z.string().trim().min(3).max(120).optional(),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return recordSandboxPayoutOutcome({ ...input, actorUserId: ctx.user.id });
  }),
  recoverPayout: authedQuery.input(z.object({ payoutId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return recoverFailedPayout(input.payoutId, ctx.user.id);
  }),
  reconcileBatch: authedQuery.input(z.object({
    batchId: z.string().trim().min(5).max(64),
    bankNetKobo: z.number().int().nonnegative().max(1_000_000_000_000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return reconcilePayoutBatch({ ...input, actorUserId: ctx.user.id });
  }),
  monitorIncidents: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return monitorOperationalSignals();
  }),
  acknowledgeIncident: authedQuery.input(z.object({ incidentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return acknowledgeOperationalIncident(input.incidentId, ctx.user.id);
  }),
  resolveIncident: authedQuery.input(z.object({
    incidentId: z.number().int().positive(),
    resolutionNote: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return resolveOperationalIncident(input.incidentId, ctx.user.id, input.resolutionNote);
  }),
  createDsar: authedQuery.input(z.object({
    customerPhone: z.string().trim().min(10).max(20),
    requestType: z.enum(["access", "rectification", "erasure", "objection"]),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return createDsarRequest({ ...input, actorUserId: ctx.user.id });
  }),
  verifyDsar: authedQuery.input(z.object({
    requestId: z.number().int().positive(),
    verificationNote: z.string().trim().min(10).max(1000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return verifyDsarIdentity(input.requestId, ctx.user.id, input.verificationNote);
  }),
  reviewDsar: authedQuery.input(z.object({ requestId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return startDsarReview(input.requestId, ctx.user.id);
  }),
  fulfilDsar: authedQuery.input(z.object({
    requestId: z.number().int().positive(),
    outcomeNote: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return fulfilDsarRequest(input.requestId, ctx.user.id, input.outcomeNote);
  }),
  rejectDsar: authedQuery.input(z.object({
    requestId: z.number().int().positive(),
    outcomeNote: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return rejectDsarRequest(input.requestId, ctx.user.id, input.outcomeNote);
  }),
  exportDsar: authedQuery.input(z.object({ requestId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return exportDsarEvidence(input.requestId, ctx.user.id);
  }),
  createBreach: authedQuery.input(z.object({
    title: z.string().trim().min(5).max(180),
    summary: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return createBreachAssessment({ ...input, actorUserId: ctx.user.id });
  }),
  startBreach: authedQuery.input(z.object({ assessmentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return startBreachAssessment(input.assessmentId, ctx.user.id);
  }),
  decideBreach: authedQuery.input(z.object({
    assessmentId: z.number().int().positive(),
    risk: z.enum(["low", "medium", "high"]),
    notificationDecision: z.enum(["not_required", "required"]),
    notificationOwnerUserId: z.number().int().positive(),
    decisionNote: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recordBreachDecision({ ...input, actorUserId: ctx.user.id });
  }),
  closeBreach: authedQuery.input(z.object({
    assessmentId: z.number().int().positive(),
    closureNote: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return closeBreachAssessment(input.assessmentId, ctx.user.id, input.closureNote);
  }),
  runJobs: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return runDueJobs("manual");
  }),
  activateRecruitment: authedQuery.input(z.object({ recruitmentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return activateRecruitment(input.recruitmentId, ctx.user.id);
  }),
  revokeRecruitment: authedQuery.input(z.object({ recruitmentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return revokeRecruitment({ recruitmentId: input.recruitmentId, actorUserId: ctx.user.id });
  }),
  recalculateLeads: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recalculateCampusLeadEligibility(ctx.user.id);
  }),
  promoteLead: authedQuery.input(z.object({ repId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const ranking = (await campusLeadRankings()).find((row) => row.repId === input.repId);
    if (!ranking) throw new TRPCError({ code: "NOT_FOUND", message: "Active campus rep not found" });
    if (!ranking.topDecileEligible) throw new TRPCError({ code: "FORBIDDEN", message: `Rep ranks #${ranking.rank}; only the campus top decile is eligible` });
    if (!ranking.rep.contractorAgreementSignedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Campus leads must have a signed contractor agreement" });
    await getDb().update(reps).set({
      tier: "campus_lead",
      leadPreviousTier: ranking.rep.tier === "campus_lead" ? ranking.rep.leadPreviousTier : ranking.rep.tier,
      leadPromotedAt: new Date(),
      leadDemotedAt: null,
      leadDemotionReason: null,
      leadEligibilitySyncedAt: new Date(),
    }).where(eq(reps.id, input.repId));
    await getDb().insert(auditLogs).values({ actorUserId: ctx.user.id, action: "campus_lead.promoted", entityType: "rep", entityId: String(input.repId), metadataJson: { campusId: ranking.campusId, rank: ranking.rank, confirmedCommissionKobo: ranking.confirmedCommissionKobo, contractorStatus: "contractor_not_employee" } });
    return { repId: input.repId, tier: "campus_lead" as const, rank: ranking.rank, topDecileEligible: true };
  }),
  resolveSupport: authedQuery.input(z.object({ ticketId: z.number().int().positive(), resolution: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return resolveSupportTicket({ ticketId: input.ticketId, actorUserId: ctx.user.id, actor: "ops", resolution: input.resolution });
  }),
  escalateSupport: authedQuery.input(z.object({ ticketId: z.number().int().positive(), note: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return escalateSupportTicket({ ticketId: input.ticketId, actorUserId: ctx.user.id, actor: "ops", note: input.note });
  }),
  supportTimeline: authedQuery.input(z.object({ ticketId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    const [ticket] = await getDb().select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1);
    if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found" });
    return { ticket, events: await ticketEvents(ticket.id) };
  }),
  resolveDispute: authedQuery.input(z.object({ disputeId: z.number().int().positive(), decision: z.string().min(5).max(1000), upholdRep: z.boolean() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const [dispute] = await getDb().select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
    if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
    await getDb().update(disputes).set({ state: input.upholdRep ? "resolved" : "rejected", decision: input.decision, decidedAt: new Date() }).where(eq(disputes.id, dispute.id));
    const [deal] = await getDb().select().from(deals).where(eq(deals.id, dispute.dealId)).limit(1);
    if (deal) await getDb().update(deals).set({ state: input.upholdRep ? "payable" : "void", updatedAt: new Date() }).where(eq(deals.id, deal.id));
    await getDb().insert(auditLogs).values({ actorUserId: ctx.user.id, action: "dispute.decided", entityType: "dispute", entityId: String(dispute.id), metadataJson: { upholdRep: input.upholdRep, decision: input.decision } });
    return { disputeId: dispute.id, state: input.upholdRep ? "resolved" : "rejected" };
  }),
});
