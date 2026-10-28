import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campuses,
  commissionRules,
  crmSegments,
  deals,
  opportunities,
  opportunityActivities,
  opportunityTasks,
  outreachDrafts,
  products,
  reps,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPhone, randomReference } from "./security";
import { buildOutreachDraft, opportunityStall, probabilityForStage, scoreOpportunity, weightedForecastKobo } from "./salesPolicy";
import { actorRepIds, type SalesActor } from "./salesAccess";

function safeOpportunity<T extends typeof opportunities.$inferSelect>(opportunity: T) {
  const { customerPhoneHash, ...safe } = opportunity;
  void customerPhoneHash;
  return safe;
}

async function accessibleOpportunity(actor: SalesActor, opportunityId: number) {
  const [opportunity] = await getDb().select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opportunity) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
  if (["ops", "finance", "admin"].includes(actor.role)) return opportunity;
  if (actor.role === "vendor" && opportunity.vendorId === actor.vendorId) return opportunity;
  if (actor.role === "rep") {
    const ids = await actorRepIds(actor);
    if (ids.includes(opportunity.repId)) return opportunity;
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
}

function assertPipelineEditor(actor: SalesActor, opportunity: typeof opportunities.$inferSelect) {
  if (["ops", "admin"].includes(actor.role)) return;
  if (actor.role === "rep" && actor.repId === opportunity.repId) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Only the opportunity owner or Operations can change this relationship" });
}

export async function listPipeline(actor: SalesActor) {
  const db = getDb();
  let rows = await db.select({ opportunity: opportunities, productName: products.name, productCategory: products.category, campusName: campuses.name, repCode: reps.code, repName: users.name, vendorName: vendors.companyName })
    .from(opportunities)
    .innerJoin(products, eq(opportunities.productId, products.id))
    .innerJoin(campuses, eq(opportunities.campusId, campuses.id))
    .innerJoin(reps, eq(opportunities.repId, reps.id))
    .innerJoin(users, eq(reps.userId, users.id))
    .innerJoin(vendors, eq(opportunities.vendorId, vendors.id))
    .orderBy(desc(opportunities.updatedAt)).limit(200);
  if (actor.role === "rep") {
    const ids = await actorRepIds(actor);
    rows = rows.filter((row) => ids.includes(row.opportunity.repId));
  } else if (actor.role === "vendor") {
    rows = rows.filter((row) => row.opportunity.vendorId === actor.vendorId);
  }
  const ids = rows.map((row) => row.opportunity.id);
  const [activities, tasks, drafts, segments] = await Promise.all([
    ids.length ? db.select().from(opportunityActivities).where(inArray(opportunityActivities.opportunityId, ids)).orderBy(desc(opportunityActivities.createdAt)) : [],
    ids.length ? db.select().from(opportunityTasks).where(inArray(opportunityTasks.opportunityId, ids)).orderBy(opportunityTasks.dueAt) : [],
    ids.length && actor.role !== "vendor" ? db.select().from(outreachDrafts).where(inArray(outreachDrafts.opportunityId, ids)).orderBy(desc(outreachDrafts.createdAt)) : [],
    db.select().from(crmSegments).where(eq(crmSegments.userId, actor.userId)).orderBy(crmSegments.name),
  ]);
  const now = new Date();
  const pipeline = rows.map((row) => ({
    ...row,
    opportunity: safeOpportunity(row.opportunity),
    stall: opportunityStall(row.opportunity, now),
  }));
  const open = pipeline.filter((row) => !["won", "lost"].includes(row.opportunity.stage));
  const won = pipeline.filter((row) => row.opportunity.stage === "won");
  return {
    opportunities: pipeline,
    activities,
    tasks,
    drafts,
    segments,
    metrics: {
      open: open.length,
      stalled: open.filter((row) => row.stall.stalled).length,
      dueToday: tasks.filter((task) => task.state === "open" && task.dueAt <= new Date(now.getTime() + 86_400_000)).length,
      weightedForecastKobo: weightedForecastKobo(pipeline.map((row) => row.opportunity)),
      openExpectedKobo: open.reduce((sum, row) => sum + row.opportunity.expectedCommissionKobo, 0),
      won: won.length,
      conversionRate: pipeline.length ? Math.round(won.length / pipeline.length * 100) : 0,
    },
    boundary: "CRM forecasts are planning estimates, not earned commission. Only vendor-verified activation events create financial deals.",
  };
}

export async function createOpportunity(input: {
  actor: SalesActor;
  repId: number;
  productId: number;
  alias: string;
  customerPhone?: string;
  nextActionAt?: Date;
  source?: string;
}) {
  if (input.actor.role === "rep" && input.actor.repId !== input.repId) throw new TRPCError({ code: "FORBIDDEN", message: "Create opportunities only in your own pipeline" });
  if (!["rep", "ops", "admin"].includes(input.actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Vendor workspaces cannot create rep-owned opportunities" });
  const db = getDb();
  const [rep] = await db.select().from(reps).where(eq(reps.id, input.repId)).limit(1);
  const [productRow] = await db.select({ product: products, vendor: vendors, rule: commissionRules }).from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .leftJoin(commissionRules, and(eq(commissionRules.productId, products.id), isNull(commissionRules.supersededAt)))
    .where(and(eq(products.id, input.productId), eq(products.status, "active"))).limit(1);
  if (!rep || !productRow?.rule) throw new TRPCError({ code: "NOT_FOUND", message: "Active rep or versioned product terms not found" });
  const phoneHash = input.customerPhone ? hashPhone(input.customerPhone) : null;
  if (phoneHash) {
    const [existing] = await db.select({ id: opportunities.id }).from(opportunities)
      .where(and(eq(opportunities.repId, rep.id), eq(opportunities.vendorId, productRow.vendor.id), eq(opportunities.customerPhoneHash, phoneHash), inArray(opportunities.stage, ["targeted", "contacted", "qualified", "activation_pending"]))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "An open opportunity already exists for this salted customer/vendor relationship" });
  }
  const expectedCommissionKobo = productRow.rule.basis === "flat"
    ? Math.round((productRow.rule.flatAmountKobo || 0) * 0.8)
    : Math.round(productRow.product.priceKobo * (productRow.rule.pctBps || 0) / 10_000 * 0.8);
  const score = scoreOpportunity({ stage: "targeted", productFitScore: productRow.vendor.qualityScore, hasConsentedAttribution: Boolean(phoneHash), activityCount: 0, nextActionAt: input.nextActionAt || null });
  const opportunityRef = randomReference("KF-O").toUpperCase();
  return db.transaction(async (tx) => {
    const [{ id }] = await tx.insert(opportunities).values({
      opportunityRef,
      alias: input.alias,
      repId: rep.id,
      campusId: rep.campusId,
      productId: productRow.product.id,
      vendorId: productRow.vendor.id,
      customerPhoneHash: phoneHash,
      expectedCommissionKobo,
      probability: 10,
      score: score.score,
      scoreReasons: score.reasons,
      nextActionAt: input.nextActionAt || null,
      createdByUserId: input.actor.userId,
    }).returning({ id: opportunities.id });
    await tx.insert(opportunityActivities).values({ opportunityId: id, actorUserId: input.actor.userId, activityType: "opportunity_created", body: `Opportunity created from ${input.source || "manual pipeline entry"}; no financial deal was created`, metadataJson: { productId: productRow.product.id, source: input.source || "manual" } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "crm.opportunity_created", entityType: "opportunity", entityId: String(id), metadataJson: { repId: rep.id, productId: productRow.product.id, phoneStored: "salted_hash_or_absent" } });
    return { opportunityId: id, opportunityRef, stage: "targeted" as const, expectedCommissionKobo, financialDealCreated: false };
  });
}

export async function updateOpportunityStage(input: { actor: SalesActor; opportunityId: number; stage: typeof opportunities.$inferSelect["stage"]; expectedVersion: number; lostReason?: string }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  assertPipelineEditor(input.actor, opportunity);
  if (input.stage === "lost" && !input.lostReason?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Record a loss reason for pipeline learning" });
  if (input.stage === "won") {
    if (!opportunity.customerPhoneHash) throw new TRPCError({ code: "BAD_REQUEST", message: "A won stage requires privacy-preserving attribution and a verified deal" });
    const [verifiedDeal] = await getDb().select({ id: deals.id, state: deals.state }).from(deals)
      .where(and(eq(deals.repId, opportunity.repId), eq(deals.productId, opportunity.productId), eq(deals.customerPhoneHash, opportunity.customerPhoneHash), inArray(deals.state, ["confirmed", "payable", "paid"]))).limit(1);
    if (!verifiedDeal) throw new TRPCError({ code: "BAD_REQUEST", message: "Won requires a confirmed, payable or paid vendor-verified deal; CRM cannot manufacture that outcome" });
  }
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(opportunities).where(eq(opportunities.id, opportunity.id)).limit(1).for("update");
    if (!locked || locked.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "This opportunity changed elsewhere; refresh before moving its stage" });
    const now = new Date();
    await tx.update(opportunities).set({ stage: input.stage, probability: probabilityForStage(input.stage), lostReason: input.stage === "lost" ? input.lostReason || null : null, lastActivityAt: now, version: locked.version + 1, updatedAt: now }).where(eq(opportunities.id, locked.id));
    await tx.insert(opportunityActivities).values({ opportunityId: locked.id, actorUserId: input.actor.userId, activityType: "stage_change", body: `${locked.stage.replaceAll("_", " ")} → ${input.stage.replaceAll("_", " ")}${input.lostReason ? `: ${input.lostReason}` : ""}`, metadataJson: { fromStage: locked.stage, toStage: input.stage, financialStateChanged: false } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "crm.opportunity_stage_changed", entityType: "opportunity", entityId: String(locked.id), metadataJson: { fromStage: locked.stage, toStage: input.stage, financialStateChanged: false } });
    return { opportunityId: locked.id, stage: input.stage, probability: probabilityForStage(input.stage), financialStateChanged: false };
  });
}

export async function addOpportunityActivity(input: { actor: SalesActor; opportunityId: number; activityType: "note" | "call" | "meeting" | "message"; body: string; nextActionAt?: Date | null }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  assertPipelineEditor(input.actor, opportunity);
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(opportunities).where(eq(opportunities.id, opportunity.id)).limit(1).for("update");
    if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
    const now = new Date();
    const [{ id }] = await tx.insert(opportunityActivities).values({ opportunityId: locked.id, actorUserId: input.actor.userId, activityType: input.activityType, body: input.body }).returning({ id: opportunityActivities.id });
    await tx.update(opportunities).set({ lastActivityAt: now, nextActionAt: input.nextActionAt === undefined ? locked.nextActionAt : input.nextActionAt, version: locked.version + 1, updatedAt: now }).where(eq(opportunities.id, locked.id));
    return { activityId: id, opportunityId: locked.id, lastActivityAt: now, nextActionAt: input.nextActionAt === undefined ? locked.nextActionAt : input.nextActionAt };
  });
}

export async function createOpportunityTask(input: { actor: SalesActor; opportunityId: number; title: string; dueAt: Date }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  assertPipelineEditor(input.actor, opportunity);
  const [{ id }] = await getDb().insert(opportunityTasks).values({ opportunityId: opportunity.id, assignedRepId: opportunity.repId, title: input.title, dueAt: input.dueAt, createdByUserId: input.actor.userId }).returning({ id: opportunityTasks.id });
  await getDb().update(opportunities).set({ nextActionAt: input.dueAt, updatedAt: new Date() }).where(eq(opportunities.id, opportunity.id));
  await getDb().insert(opportunityActivities).values({ opportunityId: opportunity.id, actorUserId: input.actor.userId, activityType: "task_created", body: `${input.title} · due ${input.dueAt.toISOString()}`, metadataJson: { taskId: id } });
  return { taskId: id, opportunityId: opportunity.id, state: "open" as const };
}

export async function setOpportunityTaskState(input: { actor: SalesActor; taskId: number; state: "completed" | "dismissed" }) {
  const [task] = await getDb().select().from(opportunityTasks).where(eq(opportunityTasks.id, input.taskId)).limit(1);
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  const opportunity = await accessibleOpportunity(input.actor, task.opportunityId);
  assertPipelineEditor(input.actor, opportunity);
  if (task.state !== "open") throw new TRPCError({ code: "CONFLICT", message: "This task has already been resolved" });
  const now = new Date();
  await getDb().update(opportunityTasks).set({ state: input.state, completedAt: now }).where(eq(opportunityTasks.id, task.id));
  await getDb().insert(opportunityActivities).values({ opportunityId: opportunity.id, actorUserId: input.actor.userId, activityType: `task_${input.state}`, body: task.title, metadataJson: { taskId: task.id } });
  return { taskId: task.id, state: input.state, completedAt: now };
}

export async function generateOutreachDraft(input: { actor: SalesActor; opportunityId: number }) {
  const opportunity = await accessibleOpportunity(input.actor, input.opportunityId);
  assertPipelineEditor(input.actor, opportunity);
  const [product] = await getDb().select().from(products).where(eq(products.id, opportunity.productId)).limit(1);
  const [latest] = await getDb().select().from(opportunityActivities).where(eq(opportunityActivities.opportunityId, opportunity.id)).orderBy(desc(opportunityActivities.createdAt)).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity product not found" });
  const generated = buildOutreachDraft({ alias: opportunity.alias, productName: product.name, stage: opportunity.stage, lastActivityBody: latest?.body, nextActionAt: opportunity.nextActionAt });
  const [{ id }] = await getDb().insert(outreachDrafts).values({ opportunityId: opportunity.id, body: generated.body, rationale: generated.rationale, createdByUserId: input.actor.userId }).returning({ id: outreachDrafts.id });
  await getDb().insert(opportunityActivities).values({ opportunityId: opportunity.id, actorUserId: input.actor.userId, activityType: "outreach_drafted", body: "Contextual outreach drafted for human approval; nothing was sent", metadataJson: { draftId: id, deterministicRules: true } });
  return { draftId: id, ...generated, state: "draft" as const, sent: false };
}

export async function setOutreachState(input: { actor: SalesActor; draftId: number; action: "approve" | "mark_shared" | "dismiss" }) {
  const [draft] = await getDb().select().from(outreachDrafts).where(eq(outreachDrafts.id, input.draftId)).limit(1);
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Outreach draft not found" });
  const opportunity = await accessibleOpportunity(input.actor, draft.opportunityId);
  assertPipelineEditor(input.actor, opportunity);
  const expected = input.action === "approve" ? "draft" : input.action === "mark_shared" ? "approved" : "draft";
  if (draft.state !== expected) throw new TRPCError({ code: "CONFLICT", message: `Draft must be ${expected} for this action` });
  const state = input.action === "approve" ? "approved" : input.action === "mark_shared" ? "shared" : "dismissed";
  const now = new Date();
  await getDb().update(outreachDrafts).set({ state, approvedByUserId: input.action === "approve" ? input.actor.userId : draft.approvedByUserId, approvedAt: input.action === "approve" ? now : draft.approvedAt, sharedAt: input.action === "mark_shared" ? now : draft.sharedAt }).where(eq(outreachDrafts.id, draft.id));
  await getDb().insert(opportunityActivities).values({ opportunityId: opportunity.id, actorUserId: input.actor.userId, activityType: input.action === "mark_shared" ? "outreach_marked_shared" : `outreach_${state}`, body: input.action === "mark_shared" ? "Rep attested that the approved draft was shared externally; KampusForce sent no message" : `Outreach draft ${state}`, metadataJson: { draftId: draft.id, externalDeliveryByPlatform: false } });
  if (input.action === "mark_shared") await getDb().update(opportunities).set({ lastActivityAt: now, updatedAt: now }).where(eq(opportunities.id, opportunity.id));
  return { draftId: draft.id, state, externalDeliveryByPlatform: false };
}

export async function saveCrmSegment(input: { actor: SalesActor; name: string; filters: Record<string, unknown> }) {
  const [existing] = await getDb().select().from(crmSegments).where(and(eq(crmSegments.userId, input.actor.userId), eq(crmSegments.name, input.name))).limit(1);
  if (existing) {
    await getDb().update(crmSegments).set({ filtersJson: input.filters }).where(eq(crmSegments.id, existing.id));
    return { segmentId: existing.id, updated: true };
  }
  const [{ id }] = await getDb().insert(crmSegments).values({ userId: input.actor.userId, name: input.name, filtersJson: input.filters }).returning({ id: crmSegments.id });
  return { segmentId: id, updated: false };
}
