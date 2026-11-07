import { notifyUser } from "./services/notifications";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campusLeadOverrides,
  campusRecruitments,
  campuses,
  campusInterest,
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
  vendors, enrollmentAttestations
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
  resolveDealDispute,
  runPayoutBatch,
} from "./services/ledger";
import { campusLeadRankings, recalculateCampusLeadEligibility } from "./services/leadEligibility";
import { escalateSupportTicket, isSlaBreached, resolveSupportTicket, syncSlaBreaches, ticketEvents } from "./services/support";
import { activateRecruitment, activateSelfRegisteredRep, revokeRecruitment } from "./services/recruiting";
import { listBankAccountReviews, reviewBankAccount } from "./services/payoutDestinations";
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
import { createOperationsFraudCase, listFraudDesk, reviewFraudCase } from "./services/fraud";
import {
  approveLaunchGate,
  getLaunchReadiness,
  rejectLaunchGate,
  submitLaunchGateEvidence,
} from "./services/launchReadiness";
import {
  captureCampusCohortSnapshot,
  captureRolloutQuarterSnapshot,
  createCampusCohort,
  createRolloutQuarter,
  getRolloutReadiness,
  reviewRolloutEvidence,
  submitExternalRolloutEvidence,
} from "./services/rolloutReadiness";
import { approveRecordedSale, rejectRecordedSale, salesToVerify } from "./services/recordedSales";

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
    const fraud = await listFraudDesk();
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
        openFraudCases: fraud.cases.filter(({ fraudCase }) => ["open", "appeal_open"].includes(fraudCase.state)).length,
        overdueFraudCases: fraud.cases.filter((row) => row.overdue).length,
        blockingFraudHolds: fraud.holds.filter((hold) => ["active", "upheld"].includes(hold.state)).length,
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
      campusInterest: await getDb().select({ university: campusInterest.university, state: campusInterest.state, requests: sql<number>`count(*)::int` }).from(campusInterest)
        .groupBy(campusInterest.university, campusInterest.state).orderBy(desc(sql`count(*)`)).limit(50),
      pendingReps: await getDb().select({ repId: reps.id, code: reps.code, name: users.name, email: users.email, kycState: users.kycState, bankNameMatch: users.bankNameMatch, campusName: campuses.name })
        .from(reps).innerJoin(users, eq(users.id, reps.userId)).innerJoin(campuses, eq(campuses.id, reps.campusId)).where(eq(reps.status, "pending")).orderBy(desc(reps.createdAt)).limit(50),
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
      fraudCases: fraud.cases,
      fraudHolds: fraud.holds,
      fraudCaseEvents: fraud.events,
      fraudRepOptions: fraud.repOptions,
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
  createFraudCase: authedQuery.input(z.object({
    repId: z.number().int().positive(),
    note: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return createOperationsFraudCase({ ...input, actorUserId: ctx.user.id });
  }),
  reviewFraudCase: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    decision: z.enum(["release", "uphold"]),
    conductAction: z.enum(["strike", "suspension"]),
    note: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return reviewFraudCase({ ...input, actorUserId: ctx.user.id });
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
  createCampus: authedQuery.input(z.object({ name: z.string().trim().min(3).max(160), state: z.string().trim().min(2).max(80), status: z.enum(["planned", "launching", "live", "paused"]) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const [campus] = await getDb().insert(campuses).values({ ...input, launchDate: input.status === "live" ? new Date() : null }).onConflictDoNothing({ target: campuses.name }).returning();
    if (!campus) throw new TRPCError({ code: "CONFLICT", message: "A campus with this name already exists" });
    await getDb().insert(auditLogs).values({ actorUserId: ctx.user.id, action: "campus.created", entityType: "campus", entityId: String(campus.id), metadataJson: { name: campus.name, status: campus.status } });
    return campus;
  }),
  setCampusStatus: authedQuery.input(z.object({ campusId: z.number().int().positive(), status: z.enum(["planned", "launching", "live", "paused"]) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(campuses).where(eq(campuses.id, input.campusId)).limit(1).for("update");
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Campus not found" });
      const [campus] = await tx.update(campuses).set({ status: input.status, launchDate: input.status === "live" ? current.launchDate ?? new Date() : current.launchDate }).where(eq(campuses.id, current.id)).returning();
      await tx.insert(auditLogs).values({ actorUserId: ctx.user.id, action: "campus.status_changed", entityType: "campus", entityId: String(current.id), metadataJson: { from: current.status, to: input.status } });
      return campus;
    });
  }),
  bankAccountReviews: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return listBankAccountReviews();
  }),
  reviewBankAccount: authedQuery.input(z.object({
    userId: z.number().int().positive(),
    approve: z.boolean(),
    note: z.string().trim().min(5).max(500),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const result = await reviewBankAccount({ ...input, reviewerUserId: ctx.user.id });
    await notifyUser(input.approve
      ? { userId: input.userId, type: "payout_account_approved", title: "Your bank account is confirmed", body: "Operations confirmed your bank account. Payouts can go to it now.", href: "/rep/earnings", entityType: "payout_destination", entityId: String(input.userId) }
      : { userId: input.userId, type: "payout_account_rejected", title: "Your bank account wasn't confirmed", body: `Operations couldn't confirm the account is yours: ${input.note} Add an account in your own name.`, href: "/rep/earnings", entityType: "payout_destination", entityId: String(input.userId) });
    return result;
  }),
  // New reps waiting to be activated, with what each still needs, so Operations can activate from ID checks.
  salesToVerify: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin", "finance"]);
    return salesToVerify();
  }),
  verifySale: authedQuery.input(z.object({ id: z.number().int().positive(), approve: z.boolean(), reason: z.string().trim().min(5).max(500), amountKobo: z.number().int().positive().max(10_000_000_000).optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return input.approve
      ? approveRecordedSale({ id: input.id, reviewerUserId: ctx.user.id, reason: input.reason, amountKobo: input.amountKobo })
      : rejectRecordedSale({ id: input.id, reviewerUserId: ctx.user.id, reason: input.reason });
  }),
  repsToActivate: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin", "finance"]);
    const rows = await getDb().select({ repId: reps.id, userId: users.id, code: reps.code, name: users.name, email: users.email, kycState: users.kycState, campusName: campuses.name, termsAcceptedAt: reps.contractorAgreementSignedAt, createdAt: reps.createdAt })
      .from(reps).innerJoin(users, eq(users.id, reps.userId)).innerJoin(campuses, eq(campuses.id, reps.campusId))
      .where(eq(reps.status, "pending")).orderBy(desc(reps.createdAt)).limit(100);
    const userIds = rows.map((r) => r.userId);
    const enrolments = userIds.length ? await getDb().select({ userId: enrollmentAttestations.userId, state: enrollmentAttestations.state, validUntil: enrollmentAttestations.validUntil })
      .from(enrollmentAttestations).where(inArray(enrollmentAttestations.userId, userIds)).orderBy(desc(enrollmentAttestations.createdAt)) : [];
    const invitations = userIds.length ? await getDb().select({ id: campusRecruitments.id, userId: campusRecruitments.acceptedUserId })
      .from(campusRecruitments).where(and(inArray(campusRecruitments.acceptedUserId, userIds), eq(campusRecruitments.status, "accepted"))) : [];
    const now = Date.now();
    return rows.map((row) => {
      const latest = enrolments.find((e) => e.userId === row.userId);
      const enrolment = !latest ? "missing" : latest.state === "verified" && (!latest.validUntil || latest.validUntil.getTime() > now) ? "verified" : latest.state === "submitted" ? "submitted" : "redo";
      const idApproved = row.kycState === "verified";
      const waitingOn = [
        !idApproved && (row.kycState === "pending" ? "ID check waiting for review" : "ID check not sent"),
        enrolment === "submitted" && "Enrolment proof waiting for review",
        enrolment === "missing" && "Enrolment proof not sent",
        enrolment === "redo" && "Enrolment proof needs sending again",
        !row.termsAcceptedAt && "Contractor terms not accepted",
      ].filter(Boolean) as string[];
      return { ...row, idApproved, enrolment, invitationId: invitations.find((i) => i.userId === row.userId)?.id ?? null, ready: waitingOn.length === 0, waitingOn };
    });
  }),
  activateRep: authedQuery.input(z.object({ repId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    try {
      return await activateSelfRegisteredRep(input.repId, ctx.user.id);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "This rep can't be activated yet" });
    }
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
  launchReadiness: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return getLaunchReadiness();
  }),
  submitLaunchEvidence: authedQuery.input(z.object({
    gateId: z.number().int().positive(),
    evidenceReference: z.string().trim().min(3).max(500),
    note: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return submitLaunchGateEvidence({ ...input, actorUserId: ctx.user.id });
  }),
  approveLaunchEvidence: authedQuery.input(z.object({
    gateId: z.number().int().positive(),
    approvalReference: z.string().trim().min(3).max(500),
    note: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return approveLaunchGate({ ...input, actorUserId: ctx.user.id });
  }),
  rejectLaunchEvidence: authedQuery.input(z.object({
    gateId: z.number().int().positive(),
    rejectionReference: z.string().trim().min(3).max(500),
    note: z.string().trim().min(10).max(2000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return rejectLaunchGate({ ...input, actorUserId: ctx.user.id });
  }),
  rolloutReadiness: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return getRolloutReadiness();
  }),
  createCampusCohort: authedQuery.input(z.object({
    campusId: z.number().int().positive(),
    label: z.string().trim().min(3).max(120),
    cohortStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    monthOneEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return createCampusCohort({ ...input, actorUserId: ctx.user.id });
  }),
  createRolloutQuarter: authedQuery.input(z.object({
    phase: z.number().int().min(1).max(3),
    label: z.string().trim().min(3).max(120),
    quarterStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quarterEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return createRolloutQuarter({ ...input, actorUserId: ctx.user.id });
  }),
  submitRolloutEvidence: authedQuery.input(z.object({
    subjectType: z.enum(["campus_cohort", "phase_quarter"]),
    subjectId: z.number().int().positive(),
    metricKey: z.string().trim().min(2).max(100),
    metricValue: z.number().finite(),
    periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    evidenceReference: z.string().trim().min(3).max(500),
    note: z.string().trim().min(10).max(2000),
    realWorldAttested: z.literal(true),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return submitExternalRolloutEvidence({ ...input, actorUserId: ctx.user.id });
  }),
  reviewRolloutEvidence: authedQuery.input(z.object({
    evidenceId: z.number().int().positive(),
    decision: z.enum(["approved", "rejected"]),
    reviewReference: z.string().trim().min(3).max(500),
    note: z.string().trim().min(10).max(2000),
    realWorldReviewAttested: z.literal(true),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return reviewRolloutEvidence({ ...input, actorUserId: ctx.user.id });
  }),
  captureRolloutSnapshot: authedQuery.input(z.object({
    subjectType: z.enum(["campus_cohort", "phase_quarter"]),
    subjectId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return input.subjectType === "campus_cohort"
      ? captureCampusCohortSnapshot(input.subjectId, ctx.user.id)
      : captureRolloutQuarterSnapshot(input.subjectId, ctx.user.id);
  }),
  resolveDispute: authedQuery.input(z.object({ disputeId: z.number().int().positive(), decision: z.string().min(5).max(1000), upholdRep: z.boolean(), correctionKobo: z.number().int().positive().max(100_000_000).optional(), reverseCommission: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const result = await resolveDealDispute({ ...input, actorUserId: ctx.user.id });
    if (result.reversed && "dealRepId" in result && result.dealRepId && result.dealVendorId) {
      const [rep] = await getDb().select({ userId: reps.userId }).from(reps).where(eq(reps.id, result.dealRepId)).limit(1);
      const [vendor] = await getDb().select({ userId: vendors.userId }).from(vendors).where(eq(vendors.id, result.dealVendorId)).limit(1);
      if (rep) await notifyUser({ userId: rep.userId, type: "commission_reversed", title: "A sale's commission was taken back", body: `Operations agreed with the vendor: ${input.decision}`, href: "/rep/earnings", entityType: "deal", entityId: result.disputeId });
      if (vendor?.userId) await notifyUser({ userId: vendor.userId, type: "commission_reversed_vendor", title: "Commission returned to your wallet", body: `Operations agreed with your dispute, and the commission went back to your wallet.`, href: "/vendor", entityType: "deal", entityId: result.disputeId });
    }
    if (result.state === "resolved" && result.correctionKobo) {
      const amount = `₦${(result.correctionKobo / 100).toLocaleString("en-NG")}`;
      const [rep] = await getDb().select({ userId: reps.userId }).from(reps).where(eq(reps.id, result.dealRepId)).limit(1);
      const [vendor] = await getDb().select({ userId: vendors.userId }).from(vendors).where(eq(vendors.id, result.dealVendorId)).limit(1);
      if (rep) await notifyUser({ userId: rep.userId, type: "commission_corrected", title: "Your commission was corrected", body: `${amount} extra goes out with your next payout.`, href: "/rep/earnings", entityType: "deal", entityId: result.disputeId });
      if (vendor?.userId) await notifyUser({ userId: vendor.userId, type: "commission_corrected", title: "A commission was corrected", body: `Operations took ${amount} from your wallet to correct a rep's commission.`, href: "/vendor", entityType: "deal", entityId: result.disputeId });
    }
    return result;
  }),
});
