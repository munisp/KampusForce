import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campusRecruitments,
  campuses,
  deals,
  opportunities,
  opportunityRecommendations,
  products,
  recruitmentEvents,
  reps,
  studentReferrals,
  trainingModules,
  trainingProgress,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { createInvitationToken, hashInvitationToken } from "./recruiting";
import { createOpportunity } from "./crm";
import { actorRepIds, assertSalesRole, type SalesActor } from "./salesAccess";
import { leaderboardPoints, scoreProductFit } from "./salesPolicy";
import { ensureTrainingCatalog } from "./training";
import { normalizePhone } from "./security";

const VERIFIED_DEAL_STATES = ["confirmed", "payable", "paid"] as const;

function assertGrowthReader(actor: SalesActor) {
  assertSalesRole(actor, ["rep", "ops", "finance", "admin"]);
}

async function accessibleRep(actor: SalesActor, repId: number) {
  const ids = await actorRepIds(actor);
  if (["ops", "finance", "admin"].includes(actor.role) || ids.includes(repId)) return;
  throw new TRPCError({ code: "NOT_FOUND", message: "Representative scope not found" });
}

async function buildLeaderboard(actor: SalesActor, days: number) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  let repRows = await db.select({ rep: reps, user: users, campus: campuses }).from(reps)
    .innerJoin(users, eq(reps.userId, users.id))
    .innerJoin(campuses, eq(reps.campusId, campuses.id))
    .where(eq(reps.status, "active"));
  if (actor.role === "rep") repRows = repRows.filter((row) => row.rep.campusId === actor.campusId);
  const repIds = repRows.map((row) => row.rep.id);
  const userIds = repRows.map((row) => row.user.id);
  const [dealRows, completed] = await Promise.all([
    repIds.length ? db.select({ repId: deals.repId, repCommissionKobo: deals.repCommissionKobo }).from(deals)
      .where(and(inArray(deals.repId, repIds), inArray(deals.state, [...VERIFIED_DEAL_STATES]), gte(deals.createdAt, since))) : [],
    userIds.length ? db.select({ userId: trainingProgress.userId, moduleId: trainingProgress.moduleId }).from(trainingProgress)
      .where(and(inArray(trainingProgress.userId, userIds), eq(trainingProgress.state, "completed"), gte(trainingProgress.completedAt, since))) : [],
  ]);
  const entries = repRows.map((row) => {
    const verified = dealRows.filter((deal) => deal.repId === row.rep.id);
    const completedTraining = completed.filter((item) => item.userId === row.user.id).length;
    const confirmedActivations = verified.length;
    const confirmedCommissionKobo = verified.reduce((sum, deal) => sum + deal.repCommissionKobo, 0);
    return {
      repId: row.rep.id,
      repCode: row.rep.code,
      displayName: row.user.name,
      campusName: row.campus.name,
      confirmedActivations,
      confirmedCommissionKobo,
      qualityScore: row.rep.qualityScore,
      completedTraining,
      points: leaderboardPoints({ confirmedActivations, confirmedCommissionKobo, qualityScore: row.rep.qualityScore, completedTraining }),
    };
  }).sort((a, b) => b.points - a.points || b.confirmedActivations - a.confirmedActivations || a.repCode.localeCompare(b.repCode));
  return entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function refreshOpportunityTargets(actor: SalesActor, repId?: number) {
  assertSalesRole(actor, ["rep", "ops", "admin"]);
  const targetRepId = repId || actor.repId;
  if (!targetRepId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a representative for opportunity targeting" });
  await accessibleRep(actor, targetRepId);
  if (actor.role === "rep" && actor.repId !== targetRepId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the opportunity owner can generate product targets" });
  const db = getDb();
  await ensureTrainingCatalog();
  const [rep] = await db.select().from(reps).where(and(eq(reps.id, targetRepId), eq(reps.status, "active"))).limit(1);
  if (!rep) throw new TRPCError({ code: "NOT_FOUND", message: "Active representative not found" });
  const productRows = await db.select({ product: products, vendor: vendors }).from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.status, "active"), eq(vendors.status, "active")));
  const verifiedDeals = await db.select({ deal: deals, product: products, rep: reps }).from(deals)
    .innerJoin(products, eq(deals.productId, products.id))
    .innerJoin(reps, eq(deals.repId, reps.id))
    .where(inArray(deals.state, [...VERIFIED_DEAL_STATES]));
  const [requiredModule] = await db.select().from(trainingModules).where(and(eq(trainingModules.moduleKey, "ethical-sales-foundations"), eq(trainingModules.active, true))).limit(1);
  const [requiredProgress] = requiredModule ? await db.select().from(trainingProgress).where(and(eq(trainingProgress.userId, rep.userId), eq(trainingProgress.moduleId, requiredModule.id), eq(trainingProgress.state, "completed"))).limit(1) : [];
  const existing = await db.select().from(opportunityRecommendations).where(eq(opportunityRecommendations.repId, rep.id));
  const now = new Date();
  for (const row of productRows) {
    const campusActivations = verifiedDeals.filter((item) => item.rep.campusId === rep.campusId && item.deal.productId === row.product.id).length;
    const repCategoryActivations = verifiedDeals.filter((item) => item.deal.repId === rep.id && item.product.category === row.product.category).length;
    const prior = existing.find((item) => item.productId === row.product.id);
    const scored = scoreProductFit({
      vendorQualityScore: row.vendor.qualityScore,
      campusActivations,
      repCategoryActivations,
      requiredTrainingCompleted: Boolean(requiredProgress),
      alreadyRecommended: Boolean(prior),
    });
    await db.insert(opportunityRecommendations).values({ repId: rep.id, productId: row.product.id, score: scored.score, reasons: scored.reasons, updatedAt: now })
      .onConflictDoUpdate({ target: [opportunityRecommendations.repId, opportunityRecommendations.productId], set: { score: scored.score, reasons: scored.reasons, updatedAt: now } });
  }
  await db.insert(auditLogs).values({ actorUserId: actor.userId, action: "growth.targets_refreshed", entityType: "rep", entityId: String(rep.id), metadataJson: { productCount: productRows.length, deterministicRules: true, financialStateChanged: false } });
  return { repId: rep.id, productsEvaluated: productRows.length, financialStateChanged: false };
}

export async function listGrowthWorkspace(actor: SalesActor, days = 30) {
  assertGrowthReader(actor);
  const db = getDb();
  const repIds = await actorRepIds(actor);
  let recommendations = await db.select({ recommendation: opportunityRecommendations, product: products, vendorName: vendors.companyName, repCode: reps.code })
    .from(opportunityRecommendations)
    .innerJoin(products, eq(opportunityRecommendations.productId, products.id))
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .innerJoin(reps, eq(opportunityRecommendations.repId, reps.id))
    .orderBy(desc(opportunityRecommendations.score), desc(opportunityRecommendations.updatedAt));
  if (actor.role === "rep") recommendations = recommendations.filter((row) => repIds.includes(row.recommendation.repId));
  const wonOpportunityIds = recommendations.filter((row) => row.recommendation.opportunityId).map((row) => row.recommendation.opportunityId!);
  const wonOpportunities = wonOpportunityIds.length ? await db.select({ id: opportunities.id }).from(opportunities)
    .where(and(inArray(opportunities.id, wonOpportunityIds), eq(opportunities.stage, "won"))) : [];
  for (const opportunity of wonOpportunities) {
    await db.update(opportunityRecommendations).set({ state: "converted", updatedAt: new Date() })
      .where(and(eq(opportunityRecommendations.opportunityId, opportunity.id), inArray(opportunityRecommendations.state, ["suggested", "accepted"])));
  }
  const leadId = actor.tier === "campus_lead" ? actor.repId : undefined;
  const referrals = leadId ? await db.select().from(studentReferrals).where(eq(studentReferrals.leadRepId, leadId)).orderBy(desc(studentReferrals.createdAt)).limit(100) : [];
  const recruitments = leadId ? await db.select().from(campusRecruitments).where(eq(campusRecruitments.leadRepId, leadId)).orderBy(desc(campusRecruitments.invitedAt)).limit(100) : [];
  const recruitmentIds = recruitments.map((row) => row.id);
  const events = recruitmentIds.length ? await db.select().from(recruitmentEvents).where(inArray(recruitmentEvents.recruitmentId, recruitmentIds)).orderBy(desc(recruitmentEvents.createdAt)).limit(300) : [];
  const leaderboard = await buildLeaderboard(actor, days);
  return {
    leaderboard,
    recommendations,
    referrals,
    recruitments,
    recruitmentEvents: events,
    metrics: {
      suggestedTargets: recommendations.filter((row) => row.recommendation.state === "suggested").length,
      convertedTargets: recommendations.filter((row) => row.recommendation.state === "converted").length,
      openRecruitments: recruitments.filter((row) => ["invited", "accepted"].includes(row.status)).length,
      followUpsDue: recruitments.filter((row) => row.nextFollowUpAt && row.nextFollowUpAt <= new Date() && ["invited", "accepted"].includes(row.status)).length,
    },
    windowDays: days,
    boundary: "Ranks use verified deals, quality and completed learning. Recommendations are deterministic guidance, not guaranteed outcomes or financial entitlement.",
  };
}

export async function setRecommendationState(input: { actor: SalesActor; recommendationId: number; action: "accept" | "dismiss"; alias?: string; customerPhone?: string }) {
  assertSalesRole(input.actor, ["rep"]);
  const db = getDb();
  const [recommendation] = await db.select().from(opportunityRecommendations).where(eq(opportunityRecommendations.id, input.recommendationId)).limit(1);
  if (!recommendation || recommendation.repId !== input.actor.repId) throw new TRPCError({ code: "NOT_FOUND", message: "Product recommendation not found" });
  if (!["suggested", "accepted"].includes(recommendation.state)) throw new TRPCError({ code: "CONFLICT", message: "This recommendation is already closed" });
  if (input.action === "dismiss") {
    await db.update(opportunityRecommendations).set({ state: "dismissed", updatedAt: new Date() }).where(eq(opportunityRecommendations.id, recommendation.id));
    return { recommendationId: recommendation.id, state: "dismissed" as const, financialStateChanged: false };
  }
  if (recommendation.opportunityId) return { recommendationId: recommendation.id, state: "accepted" as const, opportunityId: recommendation.opportunityId, financialDealCreated: false };
  if (!input.alias?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Add a privacy-safe relationship alias before creating the target" });
  const created = await createOpportunity({ actor: input.actor, repId: recommendation.repId, productId: recommendation.productId, alias: input.alias, customerPhone: input.customerPhone, source: "explainable_product_recommendation" });
  await db.update(opportunityRecommendations).set({ state: "accepted", opportunityId: created.opportunityId, updatedAt: new Date() }).where(eq(opportunityRecommendations.id, recommendation.id));
  return { recommendationId: recommendation.id, state: "accepted" as const, opportunityId: created.opportunityId, financialDealCreated: false };
}

export async function suggestStudent(input: { actor: SalesActor; candidateName: string; strengths: string; note?: string; consentConfirmed: boolean }) {
  assertSalesRole(input.actor, ["rep"]);
  if (input.actor.tier !== "campus_lead" || !input.actor.repId || !input.actor.campusId) throw new TRPCError({ code: "FORBIDDEN", message: "Only a Campus Lead can recommend a student recruit" });
  if (!input.consentConfirmed) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirm the candidate consented to this recruiting recommendation" });
  const [{ id }] = await getDb().insert(studentReferrals).values({
    leadRepId: input.actor.repId,
    campusId: input.actor.campusId,
    candidateName: input.candidateName,
    strengths: input.strengths,
    note: input.note || null,
    consentConfirmed: true,
    createdByUserId: input.actor.userId,
  }).returning({ id: studentReferrals.id });
  await getDb().insert(auditLogs).values({ actorUserId: input.actor.userId, action: "recruiting.student_suggested", entityType: "student_referral", entityId: String(id), metadataJson: { consentConfirmed: true, phoneCollected: false } });
  return { referralId: id, state: "suggested" as const, phoneCollected: false };
}

export async function inviteSuggestedStudent(input: { actor: SalesActor; referralId: number; phone: string }) {
  assertSalesRole(input.actor, ["rep"]);
  if (input.actor.tier !== "campus_lead" || !input.actor.repId) throw new TRPCError({ code: "FORBIDDEN", message: "Only a Campus Lead can invite a recommended student" });
  const db = getDb();
  const phoneE164 = normalizePhone(input.phone);
  const invitationToken = createInvitationToken();
  return db.transaction(async (tx) => {
    const [referral] = await tx.select().from(studentReferrals).where(eq(studentReferrals.id, input.referralId)).limit(1).for("update");
    if (!referral || referral.leadRepId !== input.actor.repId) throw new TRPCError({ code: "NOT_FOUND", message: "Student recommendation not found" });
    if (!referral.consentConfirmed || referral.state !== "suggested") throw new TRPCError({ code: "CONFLICT", message: "A consent-confirmed, uninvited recommendation is required" });
    const [existing] = await tx.select({ id: campusRecruitments.id }).from(campusRecruitments)
      .where(and(eq(campusRecruitments.leadRepId, input.actor.repId!), eq(campusRecruitments.phoneE164, phoneE164), eq(campusRecruitments.status, "invited"))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This student already has an open invitation" });
    const now = new Date();
    const [{ id: recruitmentId }] = await tx.insert(campusRecruitments).values({
      leadRepId: referral.leadRepId,
      campusId: referral.campusId,
      name: referral.candidateName,
      phoneE164,
      note: referral.note,
      source: "student_recommendation",
      tokenHash: hashInvitationToken(invitationToken),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      nextFollowUpAt: new Date(now.getTime() + 2 * 86_400_000),
    }).returning({ id: campusRecruitments.id });
    await tx.update(studentReferrals).set({ state: "invited", recruitmentId, convertedAt: now }).where(eq(studentReferrals.id, referral.id));
    await tx.insert(recruitmentEvents).values({ recruitmentId, actorUserId: input.actor.userId, action: "invited_from_student_recommendation", toStatus: "invited", note: referral.strengths });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "recruiting.student_invited", entityType: "campus_recruitment", entityId: String(recruitmentId), metadataJson: { referralId: referral.id, source: "student_recommendation" } });
    return { referralId: referral.id, recruitmentId, state: "invited" as const, acceptancePath: `/recruit/accept?token=${encodeURIComponent(invitationToken)}`, nextStep: "recruit_phone_verified_acceptance" };
  });
}

export async function scheduleRecruitmentFollowUp(input: { actor: SalesActor; recruitmentId: number; nextFollowUpAt: Date; note: string }) {
  assertSalesRole(input.actor, ["rep"]);
  if (input.actor.tier !== "campus_lead" || !input.actor.repId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the owning Campus Lead can schedule recruiting follow-up" });
  const db = getDb();
  const [recruitment] = await db.select().from(campusRecruitments).where(eq(campusRecruitments.id, input.recruitmentId)).limit(1);
  if (!recruitment || recruitment.leadRepId !== input.actor.repId) throw new TRPCError({ code: "NOT_FOUND", message: "Recruitment not found" });
  if (!["invited", "accepted"].includes(recruitment.status)) throw new TRPCError({ code: "CONFLICT", message: "Follow-up is available only for open recruiting records" });
  await db.update(campusRecruitments).set({ nextFollowUpAt: input.nextFollowUpAt }).where(eq(campusRecruitments.id, recruitment.id));
  await db.insert(recruitmentEvents).values({ recruitmentId: recruitment.id, actorUserId: input.actor.userId, action: "follow_up_scheduled", fromStatus: recruitment.status, toStatus: recruitment.status, note: input.note });
  return { recruitmentId: recruitment.id, nextFollowUpAt: input.nextFollowUpAt, externalMessageSent: false };
}
