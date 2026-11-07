import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campaignEnrollments,
  campaignEvents,
  campaigns,
  campuses,
  campusRecruitments,
  deals,
  products,
  reps,
  trainingAssignments,
  trainingModules,
  trainingProgress,
  users,
  vendorPromotions,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { notifyUser } from "./notifications";
import { randomReference } from "./security";
import { validateCampaignWindow } from "./salesPolicy";
import { assertSalesRole, type SalesActor } from "./salesAccess";

type AudienceRules = {
  minQualityScore?: number;
  requiredTrainingModuleKey?: string;
  includeCampusLeads?: boolean;
  campusLeadsOnly?: boolean;
};

async function campaignForActor(actor: SalesActor, campaignId: number) {
  const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  if (["ops", "admin"].includes(actor.role)) return campaign;
  if (actor.role === "vendor" && campaign.vendorId === actor.vendorId) return campaign;
  if (actor.role === "rep" && actor.repId) {
    const [enrollment] = await getDb().select().from(campaignEnrollments).where(and(eq(campaignEnrollments.campaignId, campaign.id), eq(campaignEnrollments.repId, actor.repId))).limit(1);
    if (enrollment) return campaign;
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
}

async function syncCampaignConversions() {
  const db = getDb();
  const enrollments = await db.select({ enrollment: campaignEnrollments, campaign: campaigns }).from(campaignEnrollments)
    .innerJoin(campaigns, eq(campaignEnrollments.campaignId, campaigns.id))
    .where(and(inArray(campaignEnrollments.state, ["enrolled", "notified"]), inArray(campaigns.state, ["active", "paused", "completed"])));
  let converted = 0;
  for (const row of enrollments) {
    const since = row.enrollment.notifiedAt || row.enrollment.enrolledAt;
    let matched = false;
    if (["activation", "reactivation"].includes(row.campaign.goal)) {
      const conditions = [eq(deals.repId, row.enrollment.repId), gte(deals.createdAt, since), inArray(deals.state, ["confirmed", "payable", "paid"])];
      if (row.campaign.productId) conditions.push(eq(deals.productId, row.campaign.productId));
      const [deal] = await db.select({ id: deals.id }).from(deals).where(and(...conditions)).limit(1);
      matched = Boolean(deal);
    } else if (row.campaign.goal === "training") {
      const lessonIds = (await db.select({ moduleId: trainingAssignments.moduleId }).from(trainingAssignments).where(eq(trainingAssignments.campaignId, row.campaign.id))).map((r) => r.moduleId);
      const done = await db.select({ moduleId: trainingProgress.moduleId, completedAt: trainingProgress.completedAt }).from(trainingProgress).innerJoin(reps, eq(trainingProgress.userId, reps.userId))
        .where(and(eq(reps.id, row.enrollment.repId), eq(trainingProgress.state, "completed"), lessonIds.length ? inArray(trainingProgress.moduleId, lessonIds) : undefined));
      // With lessons attached, the rep converts once every one of them is passed, at least one after joining.
      // Older campaigns without lessons keep the old rule: any lesson passed after joining.
      matched = lessonIds.length
        ? lessonIds.every((lessonId) => done.some((r) => r.moduleId === lessonId)) && done.some((r) => r.completedAt && r.completedAt >= since)
        : done.some((r) => r.completedAt && r.completedAt >= since);
    } else if (row.campaign.goal === "recruitment") {
      const [recruitment] = await db.select({ id: campusRecruitments.id }).from(campusRecruitments)
        .where(and(eq(campusRecruitments.leadRepId, row.enrollment.repId), gte(campusRecruitments.acceptedAt, since), inArray(campusRecruitments.status, ["accepted", "activated"]))).limit(1);
      matched = Boolean(recruitment);
    }
    if (matched) {
      const now = new Date();
      const claimed = await db.update(campaignEnrollments).set({ state: "converted", convertedAt: now }).where(and(eq(campaignEnrollments.id, row.enrollment.id), isNull(campaignEnrollments.convertedAt))).returning({ id: campaignEnrollments.id });
      if (claimed.length) {
        await db.insert(campaignEvents).values({ campaignId: row.campaign.id, enrollmentId: row.enrollment.id, eventType: "record_derived_conversion", metadataJson: { goal: row.campaign.goal, externalAttestation: false } });
        converted += 1;
      }
    }
  }
  return { converted };
}

export async function listCampaignWorkspace(actor: SalesActor) {
  await syncCampaignConversions();
  const db = getDb();
  let campaignRows = await db.select({ campaign: campaigns, campusName: campuses.name, productName: products.name, vendorName: vendors.companyName, creatorName: users.name })
    .from(campaigns)
    .leftJoin(campuses, eq(campaigns.campusId, campuses.id))
    .leftJoin(products, eq(campaigns.productId, products.id))
    .leftJoin(vendors, eq(campaigns.vendorId, vendors.id))
    .innerJoin(users, eq(campaigns.createdByUserId, users.id))
    .orderBy(desc(campaigns.updatedAt)).limit(100);
  if (actor.role === "vendor") campaignRows = campaignRows.filter((row) => row.campaign.vendorId === actor.vendorId);
  let enrollments = campaignRows.length ? await db.select({ enrollment: campaignEnrollments, repCode: reps.code }).from(campaignEnrollments)
    .innerJoin(reps, eq(campaignEnrollments.repId, reps.id)).where(inArray(campaignEnrollments.campaignId, campaignRows.map((row) => row.campaign.id))) : [];
  if (actor.role === "rep") {
    const own = enrollments.filter((row) => row.enrollment.repId === actor.repId);
    const campaignIds = own.map((row) => row.enrollment.campaignId);
    campaignRows = campaignRows.filter((row) => campaignIds.includes(row.campaign.id));
    enrollments = own;
  }
  const campaignIds = campaignRows.map((row) => row.campaign.id);
  const lessons = campaignIds.length ? await db.select({ campaignId: trainingAssignments.campaignId, moduleId: trainingModules.id, title: trainingModules.title, active: trainingModules.active })
    .from(trainingAssignments).innerJoin(trainingModules, eq(trainingAssignments.moduleId, trainingModules.id)).where(inArray(trainingAssignments.campaignId, campaignIds)) : [];
  const events = campaignIds.length ? await db.select().from(campaignEvents).where(inArray(campaignEvents.campaignId, campaignIds)).orderBy(desc(campaignEvents.createdAt)).limit(250) : [];
  return {
    campaigns: campaignRows.map((row) => ({ ...row, lessons: lessons.filter((lesson) => lesson.campaignId === row.campaign.id).map(({ moduleId, title, active }) => ({ moduleId, title, active })) })),
    enrollments,
    events,
    metrics: {
      total: campaignRows.length,
      active: campaignRows.filter((row) => row.campaign.state === "active").length,
      awaitingReview: campaignRows.filter((row) => row.campaign.state === "pending_review").length,
      enrolled: enrollments.length,
      converted: enrollments.filter((row) => row.enrollment.state === "converted").length,
      conversionRate: enrollments.length ? Math.round(enrollments.filter((row) => row.enrollment.state === "converted").length / enrollments.length * 100) : 0,
    },
    boundary: "Campaigns notify reps inside KampusForce only; no texts or emails are sent. Results count what reps do after the campaign starts.",
  };
}

export async function createCampaign(input: {
  actor: SalesActor;
  name: string;
  goal: typeof campaigns.$inferSelect["goal"];
  productId?: number;
  campusId?: number;
  messageDraft: string;
  startsAt: Date;
  endsAt: Date;
  audienceRules: AudienceRules;
  trainingModuleIds?: number[];
}) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  const lessonIds = [...new Set(input.trainingModuleIds || [])];
  if (input.goal === "training" && !lessonIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one lesson for a training campaign." });
  validateCampaignWindow(input.startsAt, input.endsAt);
  const db = getDb();
  let vendorId: number | null = null;
  if (input.productId) {
    const [product] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.status, "active"))).limit(1);
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Active campaign product not found" });
    vendorId = product.vendorId;
  }
  if (input.campusId) {
    const [campus] = await db.select({ id: campuses.id }).from(campuses).where(eq(campuses.id, input.campusId)).limit(1);
    if (!campus) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign campus not found" });
  }
  if (lessonIds.length) {
    const found = await db.select({ id: trainingModules.id }).from(trainingModules).where(and(inArray(trainingModules.id, lessonIds), eq(trainingModules.active, true)));
    if (found.length !== lessonIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "One of the lessons is archived or no longer exists." });
  }
  if (input.audienceRules.requiredTrainingModuleKey) {
    const [gate] = await db.select({ id: trainingModules.id }).from(trainingModules).where(and(eq(trainingModules.moduleKey, input.audienceRules.requiredTrainingModuleKey), eq(trainingModules.active, true))).limit(1);
    if (!gate) throw new TRPCError({ code: "NOT_FOUND", message: "The lesson reps must already have passed is archived or no longer exists." });
  }
  const campaignKey = randomReference("KF-C").toUpperCase();
  return db.transaction(async (tx) => {
    const [{ id }] = await tx.insert(campaigns).values({
      campaignKey,
      name: input.name,
      goal: input.goal,
      productId: input.productId || null,
      vendorId,
      campusId: input.campusId || null,
      audienceRules: input.audienceRules,
      messageDraft: input.messageDraft,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByUserId: input.actor.userId,
    }).returning({ id: campaigns.id });
    if (lessonIds.length) await tx.insert(trainingAssignments).values(lessonIds.map((moduleId) => ({ moduleId, campaignId: id, productId: null, required: false, createdByUserId: input.actor.userId })));
    await tx.insert(campaignEvents).values({ campaignId: id, actorUserId: input.actor.userId, eventType: "campaign_created", metadataJson: { goal: input.goal, delivery: "in_app_only", lessons: lessonIds.length } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "campaign.created", entityType: "campaign", entityId: String(id), metadataJson: { goal: input.goal, productId: input.productId || null, campusId: input.campusId || null } });
    return { campaignId: id, campaignKey, state: "draft" as const };
  });
}

export async function submitCampaignReview(input: { actor: SalesActor; campaignId: number; expectedVersion: number }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  const campaign = await campaignForActor(input.actor, input.campaignId);
  if (!["draft", "rejected"].includes(campaign.state)) throw new TRPCError({ code: "CONFLICT", message: "Only a draft or rejected campaign can be submitted" });
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1).for("update");
    if (!locked || locked.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "Campaign changed elsewhere; refresh before submitting" });
    await tx.update(campaigns).set({ state: "pending_review", reviewedByUserId: null, reviewedAt: null, reviewNote: null, version: locked.version + 1, updatedAt: new Date() }).where(eq(campaigns.id, locked.id));
    await tx.insert(campaignEvents).values({ campaignId: locked.id, actorUserId: input.actor.userId, eventType: "review_submitted", metadataJson: { previousState: locked.state } });
    return { campaignId: locked.id, state: "pending_review" as const };
  });
}

export async function reviewCampaign(input: { actor: SalesActor; campaignId: number; decision: "approved" | "rejected"; note: string }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  return getDb().transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1).for("update");
    if (!campaign || campaign.state !== "pending_review") throw new TRPCError({ code: "CONFLICT", message: "Campaign is not awaiting review" });
    if (campaign.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent review is required; the campaign creator cannot approve or reject their own campaign" });
    await tx.update(campaigns).set({ state: input.decision, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: input.note, version: campaign.version + 1, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    await tx.insert(campaignEvents).values({ campaignId: campaign.id, actorUserId: input.actor.userId, eventType: `campaign_${input.decision}`, metadataJson: { note: input.note, independentReview: true } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: `campaign.${input.decision}`, entityType: "campaign", entityId: String(campaign.id), metadataJson: { independentReview: true } });
    return { campaignId: campaign.id, state: input.decision, independentlyReviewed: true };
  });
}

export async function activateCampaign(input: { actor: SalesActor; campaignId: number }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  const now = new Date();
  const result = await getDb().transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1).for("update");
    if (!campaign || !["approved", "scheduled", "paused"].includes(campaign.state)) throw new TRPCError({ code: "CONFLICT", message: "Campaign must be independently approved before activation" });
    if (campaign.startsAt > now || campaign.endsAt <= now) throw new TRPCError({ code: "BAD_REQUEST", message: "Campaign can only activate inside its scheduled window" });
    const [parentPromotion] = await tx.select().from(vendorPromotions).where(eq(vendorPromotions.recruitmentCampaignId, campaign.id)).limit(1);
    if (parentPromotion && (parentPromotion.state !== "active" || parentPromotion.targetMetAt)) throw new TRPCError({ code: "CONFLICT", message: "The parent promotion or recruitment target currently blocks campaign activation" });
    let eligibleReps = await tx.select({ rep: reps, user: users }).from(reps).innerJoin(users, eq(reps.userId, users.id)).where(eq(reps.status, "active"));
    const rules = campaign.audienceRules as AudienceRules;
    if (rules.campusLeadsOnly) eligibleReps = eligibleReps.filter((row) => row.rep.tier === "campus_lead");
    if (campaign.campusId) eligibleReps = eligibleReps.filter((row) => row.rep.campusId === campaign.campusId);
    if (rules.minQualityScore !== undefined) eligibleReps = eligibleReps.filter((row) => row.rep.qualityScore >= Number(rules.minQualityScore));
    if (rules.includeCampusLeads === false) eligibleReps = eligibleReps.filter((row) => row.rep.tier !== "campus_lead");
    if (rules.requiredTrainingModuleKey) {
      const [module] = await tx.select().from(trainingModules).where(eq(trainingModules.moduleKey, rules.requiredTrainingModuleKey)).limit(1);
      if (module) {
        const completed = await tx.select({ userId: trainingProgress.userId }).from(trainingProgress).where(and(eq(trainingProgress.moduleId, module.id), eq(trainingProgress.state, "completed")));
        const userIds = completed.map((row) => row.userId);
        eligibleReps = eligibleReps.filter((row) => userIds.includes(row.user.id));
      } else {
        eligibleReps = [];
      }
    }
    let inserted = 0;
    for (const row of eligibleReps) {
      const enrollment = await tx.insert(campaignEnrollments).values({ campaignId: campaign.id, repId: row.rep.id, state: "notified", notifiedAt: now }).onConflictDoNothing().returning({ id: campaignEnrollments.id });
      if (enrollment.length) {
        inserted += 1;
        await tx.insert(campaignEvents).values({ campaignId: campaign.id, enrollmentId: enrollment[0].id, actorUserId: input.actor.userId, eventType: "in_app_notification_queued", metadataJson: { repId: row.rep.id, externalDelivery: false } });
      }
    }
    await tx.update(campaigns).set({ state: "active", version: campaign.version + 1, updatedAt: now }).where(eq(campaigns.id, campaign.id));
    await tx.insert(campaignEvents).values({ campaignId: campaign.id, actorUserId: input.actor.userId, eventType: "campaign_activated", metadataJson: { newEnrollments: inserted, eligible: eligibleReps.length, externalDelivery: false } });
    const [lesson] = await tx.select({ id: trainingAssignments.id }).from(trainingAssignments).where(eq(trainingAssignments.campaignId, campaign.id)).limit(1);
    return { campaignId: campaign.id, state: "active" as const, newEnrollments: inserted, hasLessons: Boolean(lesson), recipients: eligibleReps.map((row) => ({ userId: row.user.id, repId: row.rep.id })) };
  });
  await Promise.all(result.recipients.map((recipient) => notifyUser({ userId: recipient.userId, type: "campaign_enrolled", title: "New campaign assignment", body: result.hasLessons ? "This campaign comes with lessons. Open Training to take them." : "Open the campaign workspace to review the approved message and goal. No external message was sent.", href: result.hasLessons ? "/sales?view=training" : "/sales?view=campaigns", entityType: "campaign", entityId: result.campaignId })));
  return { campaignId: result.campaignId, state: result.state, newEnrollments: result.newEnrollments, externalDelivery: false };
}

export async function pauseCampaign(input: { actor: SalesActor; campaignId: number }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  const campaign = await campaignForActor(input.actor, input.campaignId);
  if (campaign.state !== "active") throw new TRPCError({ code: "CONFLICT", message: "Only an active campaign can be paused" });
  await getDb().update(campaigns).set({ state: "paused", version: campaign.version + 1, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
  await getDb().insert(campaignEvents).values({ campaignId: campaign.id, actorUserId: input.actor.userId, eventType: "campaign_paused" });
  return { campaignId: campaign.id, state: "paused" as const };
}
