import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campaigns,
  consentLogs,
  crmCollaborationNotes,
  crmDuplicateReviews,
  crmFeedback,
  crmForecastScenarios,
  crmInfluenceTouchpoints,
  crmRecommendations,
  crmRoutingDecisions,
  crmRoutingRules,
  crmScorecards,
  crmSequenceSteps,
  crmSequences,
  deals,
  opportunities,
  opportunityActivities,
  opportunityTasks,
  reps,
  supportTickets,
  universalConsents,
  users,
  vendorPromotions,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { actorRepIds, type SalesActor } from "./salesAccess";
import { listPipeline } from "./crm";
import { forecastAmountKobo, nextBestRelationshipAction } from "./innovationPolicy";
import { requirePurpose } from "./platformInnovations";
import { notifyUser } from "./notifications";

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const ref = (prefix: string) => `${prefix}-${randomUUID()}`;

async function accessibleOpportunity(actor: SalesActor, opportunityId: number) {
  const [opportunity] = await getDb().select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opportunity) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
  if (["ops", "finance", "admin"].includes(actor.role)) return opportunity;
  if (actor.role === "vendor" && opportunity.vendorId === actor.vendorId) return opportunity;
  if (actor.role === "rep" && (await actorRepIds(actor)).includes(opportunity.repId)) return opportunity;
  throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
}

function editor(actor: SalesActor, opportunity: typeof opportunities.$inferSelect) {
  if (["ops", "admin"].includes(actor.role) || (actor.role === "rep" && actor.repId === opportunity.repId)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Only the relationship owner or Operations can change this CRM record" });
}

export async function generateCrmRecommendation(input: { actor: SalesActor; opportunityId: number }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  const db = getDb();
  const tasks = await db.select().from(opportunityTasks).where(and(eq(opportunityTasks.opportunityId, opportunity.id), eq(opportunityTasks.state, "open")));
  let hasConsent = false;
  if (opportunity.customerPhoneHash) {
    const [consent] = await db.select().from(consentLogs).where(and(eq(consentLogs.phoneHash, opportunity.customerPhoneHash), eq(consentLogs.purpose, "relationship_outreach"))).orderBy(desc(consentLogs.grantedAt)).limit(1);
    hasConsent = Boolean(consent);
  }
  const result = nextBestRelationshipAction({
    stage: opportunity.stage,
    openTasks: tasks.length,
    overdueTasks: tasks.filter((task) => task.dueAt <= new Date()).length,
    daysQuiet: Math.max(0, Math.floor((Date.now() - opportunity.lastActivityAt.getTime()) / 86_400_000)),
    hasConsent,
  });
  const [row] = await db.insert(crmRecommendations).values({ opportunityId: opportunity.id, actionType: result.actionType, priority: result.priority, recommendation: result.recommendation, reasonsJson: result.reasons, modelVersion: "relationship-nba-v1" }).returning();
  return row;
}

export async function reviewCrmRecommendation(input: { actor: SalesActor; recommendationId: number; state: "accepted" | "dismissed" | "completed"; feedback: string }) {
  const db = getDb();
  const [recommendation] = await db.select().from(crmRecommendations).where(eq(crmRecommendations.id, input.recommendationId)).limit(1);
  if (!recommendation) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
  const opportunity = await accessibleOpportunity(input.actor, recommendation.opportunityId);
  editor(input.actor, opportunity);
  const [row] = await db.update(crmRecommendations).set({ state: input.state, feedback: input.feedback, actorUserId: input.actor.userId, updatedAt: new Date() }).where(eq(crmRecommendations.id, recommendation.id)).returning();
  return row;
}

export async function createCrmScorecard(input: { actor: SalesActor; scorecardKey: string; weights: Record<string, number>; rationale: string }) {
  if (!["ops", "admin"].includes(input.actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations administers scorecard versions" });
  const allowed = ["productFit", "stage", "attribution", "activity", "nextAction"];
  if (Object.keys(input.weights).some((key) => !allowed.includes(key)) || Object.values(input.weights).some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 100) || Object.values(input.weights).reduce((sum, weight) => sum + weight, 0) !== 100) throw new TRPCError({ code: "BAD_REQUEST", message: "Scorecard weights must use the five declared signals and total exactly 100" });
  const db = getDb();
  const [previous] = await db.select().from(crmScorecards).where(eq(crmScorecards.scorecardKey, input.scorecardKey)).orderBy(desc(crmScorecards.version)).limit(1);
  await db.update(crmScorecards).set({ active: false }).where(eq(crmScorecards.scorecardKey, input.scorecardKey));
  const [row] = await db.insert(crmScorecards).values({ scorecardKey: input.scorecardKey, version: (previous?.version || 0) + 1, weightsJson: input.weights, rationale: input.rationale, active: true, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function applyCrmScorecard(input: { actor: SalesActor; scorecardId: number; opportunityId: number; expectedVersion: number }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  editor(input.actor, opportunity);
  const db = getDb();
  const [scorecard] = await db.select().from(crmScorecards).where(eq(crmScorecards.id, input.scorecardId)).limit(1);
  if (!scorecard?.active) throw new TRPCError({ code: "BAD_REQUEST", message: "Only the active scorecard version can be applied" });
  const [activities, closedProductOutcomes] = await Promise.all([
    db.select({ id: opportunityActivities.id }).from(opportunityActivities).where(eq(opportunityActivities.opportunityId, opportunity.id)).limit(100),
    db.select({ stage: opportunities.stage }).from(opportunities).where(and(eq(opportunities.repId, opportunity.repId), eq(opportunities.productId, opportunity.productId), inArray(opportunities.stage, ["won", "lost"]))).limit(500),
  ]);
  const signals: Record<string, number> = {
    // Derive fit from stable product/outcome evidence, never from the score being replaced.
    productFit: closedProductOutcomes.length ? Math.round(closedProductOutcomes.filter((row) => row.stage === "won").length / closedProductOutcomes.length * 100) : 50,
    stage: opportunity.probability,
    attribution: opportunity.customerPhoneHash ? 100 : 0,
    activity: Math.min(100, activities.length * 20),
    nextAction: opportunity.nextActionAt && opportunity.nextActionAt > new Date() ? 100 : 0,
  };
  const score = Math.round(Object.entries(scorecard.weightsJson).reduce((sum, [key, weight]) => sum + (signals[key] || 0) * weight / 100, 0));
  const reasons = Object.entries(scorecard.weightsJson).map(([key, weight]) => `${key}: signal ${signals[key] || 0} × weight ${weight}%`);
  const [updated] = await db.update(opportunities).set({ score, scoreReasons: [`Scorecard ${scorecard.scorecardKey} v${scorecard.version}`, ...reasons], version: opportunity.version + 1, updatedAt: new Date() }).where(and(eq(opportunities.id, opportunity.id), eq(opportunities.version, input.expectedVersion))).returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Opportunity changed before scoring; refresh and retry" });
  return { opportunityId: updated.id, score: updated.score, scoreReasons: updated.scoreReasons, scorecardVersion: scorecard.version };
}

export async function createCrmForecast(input: { actor: SalesActor; name: string; scenario: "commit" | "best" | "pipeline" }) {
  const pipeline = await listPipeline(input.actor);
  const rows = pipeline.opportunities.map((row) => row.opportunity);
  const amountKobo = forecastAmountKobo(rows, input.scenario);
  const sourceHash = hash(rows.map((row) => [row.id, row.stage, row.probability, row.expectedCommissionKobo, row.updatedAt.toISOString()]));
  const [forecast] = await getDb().insert(crmForecastScenarios).values({ forecastRef: ref("FCT"), ownerUserId: input.actor.userId, name: input.name, scenario: input.scenario, assumptionsJson: { model: 1, scenarioMultiplierBasisPoints: input.scenario === "commit" ? 8000 : input.scenario === "best" ? 11500 : 10000 }, amountKobo, opportunityCount: rows.filter((row) => !["won", "lost"].includes(row.stage)).length, sourceHash }).returning();
  return { ...forecast, earnedCommission: false, financialDealCreated: false };
}

export async function createCrmSequence(input: { actor: SalesActor; opportunityId: number; name: string; purpose: "relationship_outreach"; subjectToken: string; steps: Array<{ channel: "in_app" | "email" | "sms" | "whatsapp"; body: string; dueAt: Date }> }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  editor(input.actor, opportunity);
  if (!input.steps.length || input.steps.length > 5) throw new TRPCError({ code: "BAD_REQUEST", message: "Sequences require one to five human-reviewed steps" });
  if (input.steps.some((step, index) => index > 0 && step.dueAt <= input.steps[index - 1].dueAt)) throw new TRPCError({ code: "BAD_REQUEST", message: "Sequence steps must have strictly increasing due times" });
  return getDb().transaction(async (tx) => {
    const [sequence] = await tx.insert(crmSequences).values({ opportunityId: opportunity.id, name: input.name, purpose: input.purpose, subjectTokenHash: hash(input.subjectToken), createdByUserId: input.actor.userId }).returning();
    await tx.insert(crmSequenceSteps).values(input.steps.map((step, index) => ({ sequenceId: sequence.id, stepNumber: index + 1, channel: step.channel, body: step.body, dueAt: step.dueAt, deliveryMode: step.channel === "in_app" ? "internal_notification" : "sandbox_simulation" })));
    return { sequenceId: sequence.id, state: sequence.state, rawSubjectPersisted: false, externalDelivery: false };
  });
}

export async function approveCrmSequence(input: { actor: SalesActor; sequenceId: number }) {
  const db = getDb();
  const [sequence] = await db.select().from(crmSequences).where(eq(crmSequences.id, input.sequenceId)).limit(1);
  if (!sequence) throw new TRPCError({ code: "NOT_FOUND", message: "Sequence not found" });
  const opportunity = await accessibleOpportunity(input.actor, sequence.opportunityId);
  editor(input.actor, opportunity);
  if (sequence.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "A second human must approve the sequence" });
  if (sequence.state !== "draft") throw new TRPCError({ code: "CONFLICT", message: "Only a draft sequence can be approved" });
  const [row] = await db.update(crmSequences).set({ state: "approved", approvedByUserId: input.actor.userId, updatedAt: new Date() }).where(eq(crmSequences.id, sequence.id)).returning();
  return row;
}

export async function advanceCrmSequence(input: { actor: SalesActor; sequenceId: number }) {
  const db = getDb();
  const [sequence] = await db.select().from(crmSequences).where(eq(crmSequences.id, input.sequenceId)).limit(1);
  if (!sequence) throw new TRPCError({ code: "NOT_FOUND", message: "Sequence not found" });
  const opportunity = await accessibleOpportunity(input.actor, sequence.opportunityId);
  editor(input.actor, opportunity);
  if (!["approved", "active"].includes(sequence.state)) throw new TRPCError({ code: "CONFLICT", message: "Sequence is not approved for orchestration" });
  const [step] = await db.select().from(crmSequenceSteps).where(and(eq(crmSequenceSteps.sequenceId, sequence.id), eq(crmSequenceSteps.stepNumber, sequence.currentStep + 1), eq(crmSequenceSteps.state, "pending"))).limit(1);
  if (!step) throw new TRPCError({ code: "NOT_FOUND", message: "No pending sequence step" });
  if (step.dueAt > new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Sequence step is not yet due" });
  const access = await requirePurpose({ actor: input.actor, subjectTokenHash: sequence.subjectTokenHash, purpose: sequence.purpose, action: `crm.sequence.${step.channel}` });
  const total = await db.select({ id: crmSequenceSteps.id }).from(crmSequenceSteps).where(eq(crmSequenceSteps.sequenceId, sequence.id));
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(crmSequences).where(eq(crmSequences.id, sequence.id)).for("update").limit(1);
    if (!locked || locked.currentStep !== sequence.currentStep) throw new TRPCError({ code: "CONFLICT", message: "Sequence advanced in another session" });
    const receiptHash = hash({ sequenceId: sequence.id, stepId: step.id, accessEventId: access.accessEventId, mode: step.deliveryMode });
    await tx.update(crmSequenceSteps).set({ state: "completed", completedByUserId: input.actor.userId, completedAt: new Date(), receiptHash }).where(eq(crmSequenceSteps.id, step.id));
    const completed = locked.currentStep + 1 >= total.length;
    await tx.update(crmSequences).set({ currentStep: locked.currentStep + 1, state: completed ? "completed" : "active", updatedAt: new Date() }).where(eq(crmSequences.id, sequence.id));
    await tx.insert(opportunityActivities).values({ opportunityId: opportunity.id, actorUserId: input.actor.userId, activityType: "sequence_step", body: `${step.channel} step recorded with ${step.deliveryMode}; no external delivery claim`, metadataJson: { sequenceId: sequence.id, stepId: step.id, accessEventId: access.accessEventId, receiptHash } });
    return { sequenceId: sequence.id, stepId: step.id, completed, deliveryMode: step.deliveryMode, externalRequestMade: false, receiptHash };
  });
  if (step.channel === "in_app") {
    const [rep] = await db.select({ userId: reps.userId }).from(reps).where(eq(reps.id, opportunity.repId)).limit(1);
    if (rep) await notifyUser({ userId: rep.userId, type: "crm_sequence", title: `Sequence step ready: ${sequence.name}`, body: "An approved internal relationship step was recorded. External channels remain simulated.", href: "/sales?view=pipeline", entityType: "crm_sequence", entityId: sequence.id });
  }
  return result;
}

export async function addCrmCollaborationNote(input: { actor: SalesActor; opportunityId: number; body: string; visibility: "team" | "vendor"; mentionedUserIds: number[] }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has read-only CRM oversight" });
  const db = getDb();
  const [note] = await db.insert(crmCollaborationNotes).values({ opportunityId: opportunity.id, authorUserId: input.actor.userId, body: input.body, visibility: input.visibility, mentionedUserIds: [...new Set(input.mentionedUserIds)] }).returning();
  if (input.mentionedUserIds.length) {
    const recipients = await db.select({ id: users.id }).from(users).where(inArray(users.id, [...new Set(input.mentionedUserIds)]));
    await Promise.all(recipients.filter((recipient) => recipient.id !== input.actor.userId).map((recipient) => notifyUser({ userId: recipient.id, type: "crm_mention", title: `Mentioned on ${opportunity.opportunityRef}`, body: "A relationship collaboration note mentions you.", href: "/sales?view=pipeline", entityType: "opportunity", entityId: opportunity.id })));
  }
  return note;
}

export async function detectCrmDuplicates(input: { actor: SalesActor; opportunityId: number }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  if (!["ops", "admin"].includes(input.actor.role) && input.actor.role !== "rep") throw new TRPCError({ code: "FORBIDDEN", message: "Duplicate review is limited to relationship owners and Operations" });
  if (!opportunity.customerPhoneHash) return { candidates: 0, reviews: [], rawIdentifiersCompared: false };
  const db = getDb();
  const matches = await db.select().from(opportunities).where(and(eq(opportunities.vendorId, opportunity.vendorId), eq(opportunities.customerPhoneHash, opportunity.customerPhoneHash))).limit(20);
  const allowedRepIds = input.actor.role === "rep" ? await actorRepIds(input.actor) : null;
  const reviews = [];
  for (const match of matches.filter((row) => row.id !== opportunity.id && (!allowedRepIds || allowedRepIds.includes(row.repId)))) {
    const [first, second] = [Math.min(opportunity.id, match.id), Math.max(opportunity.id, match.id)];
    const [existing] = await db.select().from(crmDuplicateReviews).where(and(eq(crmDuplicateReviews.opportunityId, first), eq(crmDuplicateReviews.matchedOpportunityId, second))).limit(1);
    if (existing) { reviews.push(existing); continue; }
    const [review] = await db.insert(crmDuplicateReviews).values({ opportunityId: first, matchedOpportunityId: second, matchType: "salted_customer_vendor_hash", confidence: 90 }).returning();
    reviews.push(review);
  }
  return { candidates: reviews.length, reviews, rawIdentifiersCompared: false, automaticMerge: false };
}

export async function resolveCrmDuplicate(input: { actor: SalesActor; reviewId: number; state: "confirmed_duplicate" | "not_duplicate"; reason: string }) {
  const db = getDb();
  const [review] = await db.select().from(crmDuplicateReviews).where(eq(crmDuplicateReviews.id, input.reviewId)).limit(1);
  if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Duplicate review not found" });
  const opportunity = await accessibleOpportunity(input.actor, review.opportunityId);
  editor(input.actor, opportunity);
  const [row] = await db.update(crmDuplicateReviews).set({ state: input.state, reviewedByUserId: input.actor.userId, reviewReason: input.reason, reviewedAt: new Date() }).where(eq(crmDuplicateReviews.id, review.id)).returning();
  return { ...row, recordsMerged: false, recordsDeleted: false, financialAttributionChanged: false };
}

export async function addCrmInfluence(input: { actor: SalesActor; opportunityId: number; campaignId?: number; promotionId?: number; touchType: string; occurredAt: Date; evidenceRef: string }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has read-only CRM oversight" });
  const db = getDb();
  if (input.campaignId) {
    const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1);
    if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  if (input.promotionId) {
    const [promotion] = await db.select({ id: vendorPromotions.id }).from(vendorPromotions).where(eq(vendorPromotions.id, input.promotionId)).limit(1);
    if (!promotion) throw new TRPCError({ code: "NOT_FOUND", message: "Promotion not found" });
  }
  const [row] = await db.insert(crmInfluenceTouchpoints).values({ opportunityId: opportunity.id, campaignId: input.campaignId || null, promotionId: input.promotionId || null, touchType: input.touchType, occurredAt: input.occurredAt, evidenceRef: input.evidenceRef, financialAttributionChanged: false, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  return { ...row, firstTouchAttributionChanged: false, commissionEntitlementCreated: false };
}

export async function createCrmRoutingRule(input: { actor: SalesActor; name: string; campusId?: number; productId?: number; maxOpenOpportunities: number; priority: number }) {
  if (!["ops", "admin"].includes(input.actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations administers CRM routing rules" });
  const [row] = await getDb().insert(crmRoutingRules).values({ ...input, campusId: input.campusId || null, productId: input.productId || null, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function proposeCrmRouting(input: { actor: SalesActor; opportunityId: number }) {
  if (!["ops", "admin"].includes(input.actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations reviews CRM routing proposals" });
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  const db = getDb();
  const rules = await db.select().from(crmRoutingRules).where(eq(crmRoutingRules.active, true)).orderBy(crmRoutingRules.priority).limit(100);
  const matching = rules.filter((rule) => (!rule.campusId || rule.campusId === opportunity.campusId) && (!rule.productId || rule.productId === opportunity.productId));
  const candidates = await db.select().from(reps).where(and(eq(reps.campusId, opportunity.campusId), eq(reps.status, "active"))).limit(200);
  const workloads = await db.select({ id: opportunities.id, repId: opportunities.repId }).from(opportunities).where(inArray(opportunities.stage, ["targeted", "contacted", "qualified", "activation_pending"])).limit(5000);
  for (const rule of matching) {
    const available = candidates.map((rep) => ({ rep, workload: workloads.filter((row) => row.repId === rep.id).length })).filter((row) => row.workload < rule.maxOpenOpportunities).sort((a, b) => a.workload - b.workload || a.rep.id - b.rep.id);
    if (!available.length) continue;
    const chosen = available[0];
    const [decision] = await db.insert(crmRoutingDecisions).values({ opportunityId: opportunity.id, ruleId: rule.id, proposedRepId: chosen.rep.id, workload: chosen.workload, reasonsJson: [`Rule ${rule.name} matched campus/product scope`, `${chosen.workload} open opportunities is below capacity ${rule.maxOpenOpportunities}`, "Lowest workload, then stable representative ID tie-break"] }).returning();
    return decision;
  }
  const [decision] = await db.insert(crmRoutingDecisions).values({ opportunityId: opportunity.id, workload: 0, reasonsJson: ["No active rule had an eligible representative below capacity"], state: "unmatched" }).returning();
  return decision;
}

export async function applyCrmRouting(input: { actor: SalesActor; decisionId: number; expectedVersion: number }) {
  if (!["ops", "admin"].includes(input.actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations applies routing decisions" });
  const db = getDb();
  return db.transaction(async (tx) => {
    const [decision] = await tx.select().from(crmRoutingDecisions).where(eq(crmRoutingDecisions.id, input.decisionId)).for("update").limit(1);
    if (!decision || decision.state !== "proposed" || !decision.proposedRepId) throw new TRPCError({ code: "CONFLICT", message: "Only a proposed routing decision with an eligible owner can be applied" });
    const [opportunity] = await tx.select().from(opportunities).where(eq(opportunities.id, decision.opportunityId)).for("update").limit(1);
    if (!opportunity || opportunity.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "Opportunity changed before routing; refresh and retry" });
    const [rep] = await tx.select().from(reps).where(eq(reps.id, decision.proposedRepId)).limit(1);
    if (!rep || rep.status !== "active" || rep.campusId !== opportunity.campusId) throw new TRPCError({ code: "BAD_REQUEST", message: "Proposed owner is no longer eligible" });
    await tx.update(opportunities).set({ repId: rep.id, version: opportunity.version + 1, updatedAt: new Date() }).where(eq(opportunities.id, opportunity.id));
    await tx.update(crmRoutingDecisions).set({ state: "applied", decidedByUserId: input.actor.userId, decidedAt: new Date() }).where(eq(crmRoutingDecisions.id, decision.id));
    await tx.insert(opportunityActivities).values({ opportunityId: opportunity.id, actorUserId: input.actor.userId, activityType: "ownership_routed", body: `Relationship owner changed by Operations using routing decision ${decision.id}; first-touch attribution was not changed`, metadataJson: { decisionId: decision.id, previousRepId: opportunity.repId, proposedRepId: rep.id } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "crm.routing_applied", entityType: "opportunity", entityId: String(opportunity.id), metadataJson: { decisionId: decision.id, previousRepId: opportunity.repId, repId: rep.id, financialAttributionChanged: false } });
    return { opportunityId: opportunity.id, repId: rep.id, version: opportunity.version + 1, financialAttributionChanged: false };
  });
}

export async function recordCrmFeedback(input: { actor: SalesActor; opportunityId: number; subjectToken: string; category: string; rating: number; comment: string; source: string }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  const subjectTokenHash = hash(input.subjectToken);
  const access = await requirePurpose({ actor: input.actor, subjectTokenHash, purpose: "service_feedback", action: "crm.feedback.record" });
  const [row] = await getDb().insert(crmFeedback).values({ opportunityId: opportunity.id, category: input.category, rating: input.rating, comment: input.comment, source: input.source, consentEventId: access.accessEventId, createdByUserId: input.actor.userId }).returning();
  return { ...row, rawSubjectPersisted: false };
}

export async function listCrmInnovationWorkspace(actor: SalesActor) {
  const pipeline = await listPipeline(actor);
  const ids = pipeline.opportunities.map((row) => row.opportunity.id);
  const repIds = [...new Set(pipeline.opportunities.map((row) => row.opportunity.repId))];
  const db = getDb();
  const [recommendations, scorecards, forecasts, sequences, steps, notes, duplicates, influence, rules, routing, feedback, outcomeRows, caseRows, consents] = await Promise.all([
    ids.length ? db.select().from(crmRecommendations).where(inArray(crmRecommendations.opportunityId, ids)).orderBy(desc(crmRecommendations.createdAt)).limit(200) : [],
    db.select().from(crmScorecards).orderBy(desc(crmScorecards.createdAt)).limit(30),
    db.select().from(crmForecastScenarios).where(eq(crmForecastScenarios.ownerUserId, actor.userId)).orderBy(desc(crmForecastScenarios.createdAt)).limit(30),
    ids.length ? db.select().from(crmSequences).where(inArray(crmSequences.opportunityId, ids)).orderBy(desc(crmSequences.updatedAt)).limit(100) : [],
    ids.length ? db.select({ step: crmSequenceSteps }).from(crmSequenceSteps).innerJoin(crmSequences, eq(crmSequenceSteps.sequenceId, crmSequences.id)).where(inArray(crmSequences.opportunityId, ids)).orderBy(crmSequenceSteps.dueAt).limit(300) : [],
    ids.length ? db.select().from(crmCollaborationNotes).where(inArray(crmCollaborationNotes.opportunityId, ids)).orderBy(desc(crmCollaborationNotes.createdAt)).limit(200) : [],
    ids.length ? db.select().from(crmDuplicateReviews).where(and(inArray(crmDuplicateReviews.opportunityId, ids), inArray(crmDuplicateReviews.matchedOpportunityId, ids))).orderBy(desc(crmDuplicateReviews.createdAt)).limit(100) : [],
    ids.length ? db.select().from(crmInfluenceTouchpoints).where(inArray(crmInfluenceTouchpoints.opportunityId, ids)).orderBy(desc(crmInfluenceTouchpoints.occurredAt)).limit(200) : [],
    ["ops", "admin"].includes(actor.role) ? db.select().from(crmRoutingRules).orderBy(crmRoutingRules.priority).limit(100) : [],
    ids.length ? db.select().from(crmRoutingDecisions).where(inArray(crmRoutingDecisions.opportunityId, ids)).orderBy(desc(crmRoutingDecisions.createdAt)).limit(100) : [],
    ids.length ? db.select().from(crmFeedback).where(inArray(crmFeedback.opportunityId, ids)).orderBy(desc(crmFeedback.createdAt)).limit(200) : [],
    repIds.length ? db.select({ id: deals.id, repId: deals.repId, vendorId: deals.vendorId, customerPhoneHash: deals.customerPhoneHash, state: deals.state, createdAt: deals.createdAt, updatedAt: deals.updatedAt }).from(deals).where(inArray(deals.repId, repIds)).orderBy(desc(deals.updatedAt)).limit(500) : [],
    repIds.length ? db.select({ id: supportTickets.id, ticketRef: supportTickets.ticketRef, repId: supportTickets.repId, vendorId: supportTickets.vendorId, customerPhoneHash: supportTickets.customerPhoneHash, subject: supportTickets.subject, state: supportTickets.state, updatedAt: supportTickets.updatedAt }).from(supportTickets).where(inArray(supportTickets.repId, repIds)).orderBy(desc(supportTickets.updatedAt)).limit(300) : [],
    ["ops", "finance", "admin"].includes(actor.role) ? db.select().from(universalConsents).orderBy(desc(universalConsents.createdAt)).limit(100) : [],
  ]);
  const originalById = new Map<number, typeof opportunities.$inferSelect>();
  if (ids.length) {
    const originals = await db.select().from(opportunities).where(inArray(opportunities.id, ids));
    originals.forEach((row) => originalById.set(row.id, row));
  }
  const relationshipOutcomes = ids.flatMap((id) => {
    const opportunity = originalById.get(id);
    if (!opportunity?.customerPhoneHash) return [];
    return outcomeRows.filter((row) => row.vendorId === opportunity.vendorId && row.customerPhoneHash === opportunity.customerPhoneHash).map((row) => ({ opportunityId: id, dealId: row.id, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt }));
  });
  const relatedCases = ids.flatMap((id) => {
    const opportunity = originalById.get(id);
    if (!opportunity?.customerPhoneHash) return [];
    return caseRows.filter((row) => row.vendorId === opportunity.vendorId && row.customerPhoneHash === opportunity.customerPhoneHash).map((row) => ({ opportunityId: id, ticketId: row.id, ticketRef: row.ticketRef, subject: row.subject, state: row.state, updatedAt: row.updatedAt }));
  });
  const visibleNotes = notes.filter((note) => note.visibility === "team" ? actor.role !== "vendor" : actor.role !== "rep" || note.authorUserId === actor.userId);
  return {
    opportunities: pipeline.opportunities,
    activities: pipeline.activities, tasks: pipeline.tasks,
    recommendations, scorecards, forecasts, sequences, steps: steps.map((row) => row.step), notes: visibleNotes, duplicates, influence, rules, routing, feedback, relationshipOutcomes, relatedCases, consents,
    metrics: {
      openRecommendations: recommendations.filter((row) => row.state === "open").length,
      activeSequences: sequences.filter((row) => ["approved", "active"].includes(row.state)).length,
      duplicateReviews: duplicates.filter((row) => row.state === "open").length,
      routingProposals: routing.filter((row) => row.state === "proposed").length,
      averageFeedback: feedback.length ? Math.round(feedback.reduce((sum, row) => sum + row.rating, 0) / feedback.length * 10) / 10 : null,
    },
    features: ["Relationship 360", "Next Best Action", "Versioned Lead Scoring", "Scenario Forecasts", "Consent-Led Sequences", "Team Collaboration", "Duplicate Review", "Influence Touchpoints", "Capacity Routing", "Voice of Customer"],
    boundary: "CRM intelligence is planning and relationship evidence. Forecasts are not earned commission; sequences require current purpose consent and human approval; influence and routing never rewrite first-touch attribution or financial outcomes.",
  };
}
