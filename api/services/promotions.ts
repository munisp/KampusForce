import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  attributionRecords,
  auditLogs,
  campaignEnrollments,
  campaignEvents,
  campaigns,
  campusRecruitments,
  campuses,
  commissionRules,
  deals,
  escrowWallets,
  products,
  promotionContactConsents,
  promotionDeliveryRequests,
  promotionEvents,
  promotionLinks,
  promotionOrchestrationEvents,
  promotionTriggerRules,
  recruitmentEvents,
  reps,
  users,
  vendorPromotions,
  vendorServiceConnections,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { assertSalesRole, type SalesActor } from "./salesAccess";
import { validateCampaignWindow } from "./salesPolicy";
import { hashCustomerRef, normalizePhone, randomReference, signedToken } from "./security";
import { createInvitationToken, hashInvitationToken } from "./recruiting";
import { notifyOperations, notifyUser } from "./notifications";
import { assertCurrentIdentityApproval } from "./identity";
import { assertCurrentStudentAssurance } from "./studentAssurance";
import { assertNoFraudHold } from "./fraud";
import { assertLiveProviderExecutionAuthorized } from "./launchReadiness";
import {
  DEFAULT_PROMOTION_TRIGGERS,
  evaluatePromotionCapacity,
  evaluateStaffingProgress,
  scheduledPromotionTransition,
} from "./promotionPolicy";
import { activePromotionCommitmentKobo, enqueuePromotionEvent } from "./promotionSignals";

const PROMOTION_LINK_SECRET = process.env.PROMOTION_LINK_SECRET || process.env.ATTRIBUTION_SECRET || "kampusforce-sandbox-promotion-link-secret";
const VERIFIED_DEAL_STATES = ["confirmed", "payable", "paid"] as const;
const OPEN_DEAL_STATES = ["pending", "confirmed", "payable", "paid", "disputed"] as const;
// PostgreSQL stores microseconds while JavaScript dates carry milliseconds. A small
// tolerance prevents an immediately due event from skipping its first processing pass.
const ORCHESTRATION_CLOCK_TOLERANCE_MS = 1_000;

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type PromotionDbClient = Database | Transaction;

type PromotionTokenPayload = {
  linkId: number;
  promotionId: number;
  repId: number;
  productId: number;
  vendorId: number;
  exp: number;
};

function promotionTokenHash(token: string) {
  return createHash("sha256").update(`kf-promotion:${token}`).digest("hex");
}

function decodePromotionToken(token: string): PromotionTokenPayload {
  const separator = token.lastIndexOf(".");
  if (separator < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid promotion link" });
  const encoded = token.slice(0, separator);
  let payload: PromotionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PromotionTokenPayload;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid promotion link" });
  }
  const expected = signedToken(JSON.stringify(payload), PROMOTION_LINK_SECRET);
  const receivedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid promotion link signature" });
  }
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= Date.now()) throw new TRPCError({ code: "BAD_REQUEST", message: "This promotion link has expired" });
  return payload;
}

export async function resolvePromotionLink(token: string, requireActive = true) {
  const payload = decodePromotionToken(token);
  const [row] = await getDb().select({ link: promotionLinks, promotion: vendorPromotions, product: products, rep: reps, vendor: vendors }).from(promotionLinks)
    .innerJoin(vendorPromotions, eq(promotionLinks.promotionId, vendorPromotions.id))
    .innerJoin(products, eq(vendorPromotions.productId, products.id))
    .innerJoin(vendors, eq(vendorPromotions.vendorId, vendors.id))
    .innerJoin(reps, eq(promotionLinks.repId, reps.id))
    .where(and(eq(promotionLinks.id, payload.linkId), eq(promotionLinks.tokenHash, promotionTokenHash(token)))).limit(1);
  if (!row || row.link.state !== "active" || row.link.expiresAt <= new Date() || row.rep.status !== "active" || row.product.status !== "active" || row.vendor.status !== "active") {
    throw new TRPCError({ code: "NOT_FOUND", message: "This promotion link is invalid or no longer active" });
  }
  if (row.promotion.id !== payload.promotionId || row.promotion.vendorId !== payload.vendorId || row.promotion.productId !== payload.productId || row.rep.id !== payload.repId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Promotion link subject mismatch" });
  }
  const now = new Date();
  if (requireActive && (row.promotion.state !== "active" || row.promotion.startsAt > now || row.promotion.endsAt <= now)) {
    throw new TRPCError({ code: "CONFLICT", message: "This promotion is not accepting new customer acquisition" });
  }
  return row;
}

export async function resolvePromotionLinkById(linkId: number, requireActive = true) {
  const [row] = await getDb().select({ link: promotionLinks, promotion: vendorPromotions, product: products, rep: reps, vendor: vendors }).from(promotionLinks)
    .innerJoin(vendorPromotions, eq(promotionLinks.promotionId, vendorPromotions.id))
    .innerJoin(products, eq(vendorPromotions.productId, products.id))
    .innerJoin(vendors, eq(vendorPromotions.vendorId, vendors.id))
    .innerJoin(reps, eq(promotionLinks.repId, reps.id))
    .where(eq(promotionLinks.id, linkId)).limit(1);
  if (!row || row.link.state !== "active" || row.link.expiresAt <= new Date() || row.rep.status !== "active" || row.product.status !== "active" || row.vendor.status !== "active") {
    throw new TRPCError({ code: "NOT_FOUND", message: "This promotion link is invalid or no longer active" });
  }
  const now = new Date();
  if (requireActive && (row.promotion.state !== "active" || row.promotion.startsAt > now || row.promotion.endsAt <= now)) {
    throw new TRPCError({ code: "CONFLICT", message: "This promotion is not accepting new customer acquisition" });
  }
  return row;
}

export async function promotionCapacityForNewDeal(client: PromotionDbClient, promotionId: number, nextCommissionKobo: number, enforceActiveState = true) {
  const [promotion] = await client.select().from(vendorPromotions).where(eq(vendorPromotions.id, promotionId)).limit(1).for("update");
  if (!promotion) return { allowed: false, reason: "promotion_missing" as const, promotion: null, remainingBudgetKobo: 0, uncommittedEscrowKobo: 0, committedKobo: 0, pendingVendorCommitmentsKobo: 0 };
  const now = new Date();
  if (enforceActiveState && (promotion.state !== "active" || promotion.startsAt > now || promotion.endsAt <= now)) {
    return { allowed: false, reason: "promotion_inactive" as const, promotion, remainingBudgetKobo: 0, uncommittedEscrowKobo: 0, committedKobo: 0, pendingVendorCommitmentsKobo: 0 };
  }
  // A transaction client is a single PostgreSQL connection; keep its queries sequential.
  const committedKobo = await activePromotionCommitmentKobo(promotion.id, client);
  const pendingRows = await client.select({ amount: deals.vendorCommissionKobo }).from(deals)
    .where(and(eq(deals.vendorId, promotion.vendorId), eq(deals.state, "pending")));
  const wallet = await client.select().from(escrowWallets).where(eq(escrowWallets.vendorId, promotion.vendorId)).limit(1);
  const pendingVendorCommitmentsKobo = pendingRows.reduce((sum, row) => sum + row.amount, 0);
  const capacity = evaluatePromotionCapacity({
    budgetCapKobo: promotion.budgetCapKobo,
    committedKobo,
    escrowBalanceKobo: wallet[0]?.balanceKobo || 0,
    pendingVendorCommitmentsKobo,
    nextCommissionKobo,
  });
  return { ...capacity, promotion, committedKobo, pendingVendorCommitmentsKobo };
}

async function promotionForActor(actor: SalesActor, promotionId: number) {
  const [promotion] = await getDb().select().from(vendorPromotions).where(eq(vendorPromotions.id, promotionId)).limit(1);
  if (!promotion) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor promotion not found" });
  if (["ops", "admin", "finance"].includes(actor.role)) return promotion;
  if (actor.role === "vendor" && actor.vendorId === promotion.vendorId) return promotion;
  if (actor.role === "rep" && actor.repId && !["draft", "pending_review", "rejected"].includes(promotion.state)) {
    if (!promotion.campusId || promotion.campusId === actor.campusId) return promotion;
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "Vendor promotion not found" });
}

function assertPromotionWriter(actor: SalesActor) {
  assertSalesRole(actor, ["vendor", "ops", "admin"]);
}

function assertOwnVendor(actor: SalesActor, vendorId: number) {
  if (actor.role === "vendor" && actor.vendorId !== vendorId) throw new TRPCError({ code: "FORBIDDEN", message: "Manage promotions only for your own vendor" });
}

async function assertPromotionCommercialActive(client: PromotionDbClient, promotion: typeof vendorPromotions.$inferSelect) {
  const [commercial] = await client.select({ productId: products.id, vendorId: vendors.id }).from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(
      eq(products.id, promotion.productId),
      eq(vendors.id, promotion.vendorId),
      eq(products.status, "active"),
      eq(vendors.status, "active"),
    )).limit(1);
  if (!commercial) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The promotion vendor and product must both be active" });
  return commercial;
}

export async function createPromotion(input: {
  actor: SalesActor;
  name: string;
  productId: number;
  campusId?: number;
  brief: string;
  budgetCapKobo: number;
  recruitmentTarget: number;
  staffingWarningPct: number;
  startsAt: Date;
  endsAt: Date;
}) {
  assertPromotionWriter(input.actor);
  validateCampaignWindow(input.startsAt, input.endsAt);
  if (!Number.isSafeInteger(input.budgetCapKobo) || input.budgetCapKobo <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A positive promotion budget cap is required" });
  if (!Number.isInteger(input.recruitmentTarget) || input.recruitmentTarget < 1 || input.recruitmentTarget > 10_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Recruitment target must be between 1 and 10,000" });
  if (!Number.isInteger(input.staffingWarningPct) || input.staffingWarningPct < 50 || input.staffingWarningPct > 100) throw new TRPCError({ code: "BAD_REQUEST", message: "Staffing warning threshold must be between 50% and 100%" });
  const db = getDb();
  const [product] = await db.select({ product: products, vendor: vendors }).from(products)
    .innerJoin(vendors, eq(products.vendorId, vendors.id))
    .where(and(eq(products.id, input.productId), eq(products.status, "active"), eq(vendors.status, "active"))).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "An active product and vendor are required" });
  assertOwnVendor(input.actor, product.vendor.id);
  if (input.campusId) {
    const [campus] = await db.select({ id: campuses.id }).from(campuses).where(eq(campuses.id, input.campusId)).limit(1);
    if (!campus) throw new TRPCError({ code: "NOT_FOUND", message: "Promotion campus not found" });
  }
  const [rule] = await db.select({ id: commissionRules.id }).from(commissionRules)
    .where(and(eq(commissionRules.productId, product.product.id), isNull(commissionRules.supersededAt))).limit(1);
  if (!rule) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Publish commercial terms before drafting a promotion" });
  const promotionKey = randomReference("KF-P").toUpperCase();
  return db.transaction(async (tx) => {
    const [{ id }] = await tx.insert(vendorPromotions).values({
      promotionKey,
      vendorId: product.vendor.id,
      productId: product.product.id,
      campusId: input.campusId || null,
      name: input.name,
      brief: input.brief,
      budgetCapKobo: input.budgetCapKobo,
      recruitmentTarget: input.recruitmentTarget,
      staffingWarningPct: input.staffingWarningPct,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByUserId: input.actor.userId,
    }).returning({ id: vendorPromotions.id });
    await tx.insert(promotionTriggerRules).values(DEFAULT_PROMOTION_TRIGGERS.map((trigger) => ({ promotionId: id, ...trigger })));
    await tx.insert(promotionEvents).values({ promotionId: id, actorUserId: input.actor.userId, eventType: "promotion.created", metadataJson: { budgetCapKobo: input.budgetCapKobo, recruitmentTarget: input.recruitmentTarget, escrowReserved: false } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "promotion.created", entityType: "vendor_promotion", entityId: String(id), metadataJson: { productId: product.product.id, vendorId: product.vendor.id, budgetCapKobo: input.budgetCapKobo, recruitmentTarget: input.recruitmentTarget, escrowReserved: false } });
    return { promotionId: id, promotionKey, state: "draft" as const, escrowReserved: false };
  });
}

export async function submitPromotionReview(input: { actor: SalesActor; promotionId: number; expectedVersion: number }) {
  assertPromotionWriter(input.actor);
  const promotion = await promotionForActor(input.actor, input.promotionId);
  assertOwnVendor(input.actor, promotion.vendorId);
  if (!["draft", "rejected"].includes(promotion.state)) throw new TRPCError({ code: "CONFLICT", message: "Only a draft or rejected promotion can be submitted" });
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(vendorPromotions).where(eq(vendorPromotions.id, promotion.id)).limit(1).for("update");
    if (!locked || locked.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "Promotion changed elsewhere; refresh before submitting" });
    await tx.update(vendorPromotions).set({ state: "pending_review", reviewedByUserId: null, reviewedAt: null, reviewNote: null, version: locked.version + 1, updatedAt: new Date() }).where(eq(vendorPromotions.id, locked.id));
    await tx.insert(promotionEvents).values({ promotionId: locked.id, actorUserId: input.actor.userId, eventType: "promotion.review_submitted", metadataJson: { previousState: locked.state } });
    return { promotionId: locked.id, state: "pending_review" as const };
  });
}

export async function reviewPromotion(input: { actor: SalesActor; promotionId: number; decision: "approved" | "rejected"; note: string }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  const result = await getDb().transaction(async (tx) => {
    const [promotion] = await tx.select().from(vendorPromotions).where(eq(vendorPromotions.id, input.promotionId)).limit(1).for("update");
    if (!promotion || promotion.state !== "pending_review") throw new TRPCError({ code: "CONFLICT", message: "Promotion is not awaiting review" });
    if (promotion.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent review is required; the creator cannot review this promotion" });
    if (input.decision === "approved") await assertPromotionCommercialActive(tx, promotion);
    const state = input.decision === "approved" ? (promotion.startsAt <= new Date() ? "approved" : "scheduled") : "rejected";
    await tx.update(vendorPromotions).set({ state, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: input.note, version: promotion.version + 1, updatedAt: new Date() }).where(eq(vendorPromotions.id, promotion.id));
    await tx.insert(promotionEvents).values({ promotionId: promotion.id, actorUserId: input.actor.userId, eventType: `promotion.${input.decision}`, metadataJson: { independentReview: true, note: input.note } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: `promotion.${input.decision}`, entityType: "vendor_promotion", entityId: String(promotion.id), metadataJson: { independentReview: true } });
    if (input.decision === "approved") await enqueuePromotionEvent({ promotionId: promotion.id, eventType: "promotion.approved", eventKey: `promotion:${promotion.id}:approved:${promotion.version + 1}`, actorUserId: input.actor.userId }, tx);
    return { promotionId: promotion.id, state, independentlyReviewed: true };
  });
  if (input.decision === "approved") await processPromotionOrchestration();
  return result;
}

export async function changePromotionState(input: { actor: SalesActor; promotionId: number; action: "start" | "pause" | "resume" | "end" }) {
  const promotion = await promotionForActor(input.actor, input.promotionId);
  if (input.actor.role === "vendor") assertOwnVendor(input.actor, promotion.vendorId);
  if (["start", "resume"].includes(input.action)) assertSalesRole(input.actor, ["ops", "admin"]);
  else assertPromotionWriter(input.actor);
  const now = new Date();
  if (["start", "resume"].includes(input.action)) {
    const allowed = input.action === "start" ? ["approved", "scheduled"] : ["paused", "budget_exhausted"];
    if (!allowed.includes(promotion.state)) throw new TRPCError({ code: "CONFLICT", message: `Promotion cannot ${input.action} from ${promotion.state}` });
    if (promotion.startsAt > now || promotion.endsAt <= now) throw new TRPCError({ code: "BAD_REQUEST", message: "Promotion can start only inside its scheduled window" });
    const capacity = await promotionCapacityForNewDeal(getDb(), promotion.id, 0, false);
    if (capacity.remainingBudgetKobo !== undefined && (capacity.remainingBudgetKobo <= 0 || capacity.uncommittedEscrowKobo <= 0)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Restore budget headroom or uncommitted escrow before resuming" });
    }
  } else if (input.action === "pause" && promotion.state !== "active") {
    throw new TRPCError({ code: "CONFLICT", message: "Only an active promotion can be paused" });
  } else if (input.action === "end" && !["approved", "scheduled", "active", "paused", "budget_exhausted"].includes(promotion.state)) {
    throw new TRPCError({ code: "CONFLICT", message: "This promotion is already closed or has not been approved" });
  }
  const eventType = input.action === "pause" ? "promotion.paused" : input.action === "end" ? "promotion.ended" : "promotion.started";
  await enqueuePromotionEvent({ promotionId: promotion.id, eventType, eventKey: `promotion:${promotion.id}:${eventType}:${randomUUID()}`, actorUserId: input.actor.userId });
  await processPromotionOrchestration();
  const [current] = await getDb().select({ state: vendorPromotions.state }).from(vendorPromotions).where(eq(vendorPromotions.id, promotion.id)).limit(1);
  return { promotionId: promotion.id, state: current?.state, earnedPayoutsChanged: false };
}

export async function setPromotionTrigger(input: { actor: SalesActor; ruleId: number; enabled: boolean }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  return getDb().transaction(async (tx) => {
    const [rule] = await tx.select().from(promotionTriggerRules).where(eq(promotionTriggerRules.id, input.ruleId)).limit(1).for("update");
    if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Promotion trigger rule not found" });
    await tx.update(promotionTriggerRules).set({ enabled: input.enabled, updatedAt: new Date() }).where(eq(promotionTriggerRules.id, rule.id));
    await tx.insert(promotionEvents).values({ promotionId: rule.promotionId, actorUserId: input.actor.userId, eventType: "promotion.trigger_updated", metadataJson: { triggerEvent: rule.eventType, action: rule.action, enabled: input.enabled } });
    return { ruleId: rule.id, enabled: input.enabled };
  });
}

async function campaignRecipients(tx: Transaction, campaignId: number) {
  return tx.select({ userId: users.id, repId: reps.id }).from(campaignEnrollments)
    .innerJoin(reps, eq(campaignEnrollments.repId, reps.id))
    .innerJoin(users, eq(reps.userId, users.id))
    .where(eq(campaignEnrollments.campaignId, campaignId));
}

async function processOnePromotionEvent(eventId: number) {
  const notifications: Array<{ userId: number; type: string; title: string; body: string; promotionId: number }> = [];
  let didProcess = false;
  await getDb().transaction(async (tx) => {
    const [event] = await tx.select().from(promotionOrchestrationEvents).where(eq(promotionOrchestrationEvents.id, eventId)).limit(1).for("update");
    const dueWithClockTolerance = new Date(Date.now() + ORCHESTRATION_CLOCK_TOLERANCE_MS);
    if (!event || !["pending", "failed"].includes(event.state) || event.attempts >= 5 || event.availableAt > dueWithClockTolerance) return;
    didProcess = true;
    await tx.update(promotionOrchestrationEvents).set({ state: "processing", updatedAt: new Date(), lastError: null }).where(eq(promotionOrchestrationEvents.id, event.id));
    const [rule] = await tx.select().from(promotionTriggerRules).where(and(eq(promotionTriggerRules.promotionId, event.promotionId), eq(promotionTriggerRules.eventType, event.eventType))).limit(1);
    if (!rule?.enabled) {
      await tx.update(promotionOrchestrationEvents).set({ state: "processed", processedAt: new Date(), updatedAt: new Date() }).where(eq(promotionOrchestrationEvents.id, event.id));
      return;
    }
    const [promotion] = await tx.select().from(vendorPromotions).where(eq(vendorPromotions.id, event.promotionId)).limit(1).for("update");
    if (!promotion) throw new Error("Promotion disappeared before orchestration");
    const now = new Date();
    let campaignId = promotion.recruitmentCampaignId;
    if (event.eventType === "promotion.approved" && !campaignId) {
      const [{ id }] = await tx.insert(campaigns).values({
        campaignKey: randomReference("KF-RC").toUpperCase(),
        name: `${promotion.name} · representative recruitment`,
        goal: "recruitment",
        state: "approved",
        vendorId: promotion.vendorId,
        productId: promotion.productId,
        campusId: promotion.campusId,
        audienceRules: { campusLeadsOnly: true, includeCampusLeads: true },
        messageDraft: `Recruit and onboard suitable student representatives for the independently approved vendor promotion ${promotion.promotionKey}. Recruitment alone earns no commission; only vendor-verified activations follow the published commercial terms.`,
        createdByUserId: promotion.createdByUserId,
        reviewedByUserId: promotion.reviewedByUserId,
        reviewedAt: promotion.reviewedAt,
        reviewNote: `System-linked to independently reviewed promotion ${promotion.promotionKey}.`,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt,
      }).returning({ id: campaigns.id });
      campaignId = id;
      await tx.update(vendorPromotions).set({ recruitmentCampaignId: id, updatedAt: now }).where(eq(vendorPromotions.id, promotion.id));
      await tx.insert(campaignEvents).values({ campaignId: id, actorUserId: event.actorUserId, eventType: "created_from_vendor_promotion", metadataJson: { promotionId: promotion.id, independentlyApprovedParent: true, recruitmentCommission: false } });
      const leadRows = await tx.select({ userId: users.id }).from(reps).innerJoin(users, eq(reps.userId, users.id))
        .where(and(eq(reps.status, "active"), eq(reps.tier, "campus_lead"), ...(promotion.campusId ? [eq(reps.campusId, promotion.campusId)] : [])));
      for (const lead of leadRows) notifications.push({ userId: lead.userId, type: "promotion_recruitment_draft", title: "Vendor promotion recruitment drive approved", body: `${promotion.name} has a controlled recruitment campaign. It starts inside the approved schedule; recruitment alone creates no commission.`, promotionId: promotion.id });
    }
    if (event.eventType === "promotion.started") {
      if (["approved", "scheduled", "paused", "budget_exhausted"].includes(promotion.state) && promotion.startsAt <= now && promotion.endsAt > now) {
        await assertPromotionCommercialActive(tx, promotion);
        const capacity = await promotionCapacityForNewDeal(tx, promotion.id, 0, false);
        if ((capacity.remainingBudgetKobo || 0) <= 0 || (capacity.uncommittedEscrowKobo || 0) <= 0) {
          await tx.update(vendorPromotions).set({ state: "budget_exhausted", budgetStoppedAt: now, updatedAt: now, version: promotion.version + 1 }).where(eq(vendorPromotions.id, promotion.id));
        } else {
          await tx.update(vendorPromotions).set({ state: "active", budgetStoppedAt: null, updatedAt: now, version: promotion.version + 1 }).where(eq(vendorPromotions.id, promotion.id));
          if (campaignId && !promotion.targetMetAt) {
            const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1).for("update");
            if (campaign && ["approved", "scheduled", "paused"].includes(campaign.state)) {
              const eligibleLeads = await tx.select({ rep: reps, user: users }).from(reps).innerJoin(users, eq(reps.userId, users.id))
                .where(and(eq(reps.status, "active"), eq(reps.tier, "campus_lead"), ...(campaign.campusId ? [eq(reps.campusId, campaign.campusId)] : [])));
              for (const lead of eligibleLeads) {
                const inserted = await tx.insert(campaignEnrollments).values({ campaignId, repId: lead.rep.id, state: "notified", notifiedAt: now }).onConflictDoNothing().returning({ id: campaignEnrollments.id });
                if (inserted.length) {
                  await tx.insert(campaignEvents).values({ campaignId, enrollmentId: inserted[0].id, actorUserId: event.actorUserId, eventType: "in_app_notification_queued", metadataJson: { promotionId: promotion.id, externalDelivery: false } });
                  notifications.push({ userId: lead.user.id, type: "promotion_recruitment_started", title: "Promotion recruitment is active", body: `${promotion.name} is ready for consented invitations. Stop conditions and KYC/enrollment gates remain enforced.`, promotionId: promotion.id });
                }
              }
              await tx.update(campaigns).set({ state: "active", version: campaign.version + 1, updatedAt: now }).where(eq(campaigns.id, campaign.id));
              await tx.insert(campaignEvents).values({ campaignId, actorUserId: event.actorUserId, eventType: "campaign_activated", metadataJson: { promotionId: promotion.id, eligibleCampusLeads: eligibleLeads.length, externalDelivery: false } });
            }
          }
        }
      }
    }
    if (event.eventType === "promotion.paused") {
      if (promotion.state === "active") await tx.update(vendorPromotions).set({ state: "paused", updatedAt: now, version: promotion.version + 1 }).where(eq(vendorPromotions.id, promotion.id));
      if (campaignId) {
        const paused = await tx.update(campaigns).set({ state: "paused", updatedAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.state, "active"))).returning({ id: campaigns.id });
        if (paused.length) await tx.insert(campaignEvents).values({ campaignId, actorUserId: event.actorUserId, eventType: "campaign_paused", metadataJson: { promotionId: promotion.id, preserveExistingOnboarding: true } });
      }
    }
    if (event.eventType === "promotion.budget_exhausted") {
      if (!["completed", "rejected"].includes(promotion.state)) {
        await tx.update(vendorPromotions).set({ state: "budget_exhausted", budgetStoppedAt: promotion.budgetStoppedAt || now, updatedAt: now, version: promotion.version + 1 }).where(eq(vendorPromotions.id, promotion.id));
      }
    }
    if (event.eventType === "promotion.ended") {
      if (promotion.state !== "completed") await tx.update(vendorPromotions).set({ state: "completed", updatedAt: now, version: promotion.version + 1 }).where(eq(vendorPromotions.id, promotion.id));
      if (campaignId) await tx.update(campaigns).set({ state: "completed", updatedAt: now }).where(and(eq(campaigns.id, campaignId), inArray(campaigns.state, ["approved", "scheduled", "active", "paused"])));
      await tx.update(promotionLinks).set({ state: "revoked" }).where(and(eq(promotionLinks.promotionId, promotion.id), eq(promotionLinks.state, "active")));
    }
    if (event.eventType === "recruitment.target_met") {
      if (!promotion.targetMetAt) await tx.update(vendorPromotions).set({ targetMetAt: now, updatedAt: now }).where(eq(vendorPromotions.id, promotion.id));
      if (campaignId) {
        await tx.update(campaigns).set({ state: "paused", updatedAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.state, "active")));
        await tx.insert(campaignEvents).values({ campaignId, actorUserId: event.actorUserId, eventType: "recruitment_target_met", metadataJson: { stopNewInvitations: true, preserveExistingOnboarding: true } });
      }
    }
    if (event.eventType === "recruitment.target_at_risk") {
      if (campaignId) {
        const recipients = await campaignRecipients(tx, campaignId);
        for (const recipient of recipients) notifications.push({ userId: recipient.userId, type: "promotion_recruitment_risk", title: "Recruitment target needs attention", body: `${promotion.name} is behind its time-adjusted staffing target. Review consented recruiting actions; no commission is created by recruitment itself.`, promotionId: promotion.id });
      }
    }
    await tx.insert(promotionEvents).values({ promotionId: promotion.id, actorUserId: event.actorUserId, eventType: event.eventType, metadataJson: { ...event.payloadJson, action: rule.action, orchestrationEventId: event.id } });
    await tx.update(promotionOrchestrationEvents).set({ state: "processed", processedAt: now, updatedAt: now }).where(eq(promotionOrchestrationEvents.id, event.id));
  });
  if (!didProcess) return false;
  for (const notification of notifications) {
    await notifyUser({ userId: notification.userId, type: notification.type, title: notification.title, body: notification.body, href: "/sales?view=promotions", entityType: "vendor_promotion", entityId: notification.promotionId }).catch(() => undefined);
  }
  if (notifications.length === 0) {
    const [event] = await getDb().select().from(promotionOrchestrationEvents).where(eq(promotionOrchestrationEvents.id, eventId)).limit(1);
    if (event && ["promotion.budget_exhausted", "recruitment.target_at_risk"].includes(event.eventType)) {
      await notifyOperations({ type: event.eventType, title: event.eventType === "promotion.budget_exhausted" ? "Promotion acquisition stopped" : "Recruitment target at risk", body: `Review promotion #${event.promotionId}. Historical deals, earned payouts and onboarding records are preserved.`, href: "/sales?view=promotions", entityType: "vendor_promotion", entityId: event.promotionId }).catch(() => undefined);
    }
  }
  return true;
}

export async function processPromotionOrchestration(limit = 50) {
  const dueWithClockTolerance = new Date(Date.now() + ORCHESTRATION_CLOCK_TOLERANCE_MS);
  const due = await getDb().select({ id: promotionOrchestrationEvents.id }).from(promotionOrchestrationEvents)
    .where(and(inArray(promotionOrchestrationEvents.state, ["pending", "failed"]), lte(promotionOrchestrationEvents.availableAt, dueWithClockTolerance)))
    .orderBy(promotionOrchestrationEvents.createdAt).limit(limit);
  let processed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      if (await processOnePromotionEvent(row.id)) processed += 1;
    } catch (error) {
      failed += 1;
      const [event] = await getDb().select().from(promotionOrchestrationEvents).where(eq(promotionOrchestrationEvents.id, row.id)).limit(1);
      const attempts = (event?.attempts || 0) + 1;
      await getDb().update(promotionOrchestrationEvents).set({
        state: attempts >= 5 ? "dead_letter" : "failed",
        attempts,
        availableAt: new Date(Date.now() + Math.min(300, 30 * 2 ** (attempts - 1)) * 1000),
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        updatedAt: new Date(),
      }).where(eq(promotionOrchestrationEvents.id, row.id));
    }
  }
  return { due: due.length, processed, failed };
}

export async function runPromotionScheduleSweep() {
  const db = getDb();
  const rows = await db.select().from(vendorPromotions).where(inArray(vendorPromotions.state, ["approved", "scheduled", "active", "paused", "budget_exhausted"]));
  const now = new Date();
  let queued = 0;
  for (const promotion of rows) {
    if (promotion.state === "active") {
      const [commercial] = await db.select({ productId: products.id }).from(products)
        .innerJoin(vendors, eq(products.vendorId, vendors.id))
        .where(and(eq(products.id, promotion.productId), eq(vendors.id, promotion.vendorId), eq(products.status, "active"), eq(vendors.status, "active"))).limit(1);
      if (!commercial) {
        const result = await enqueuePromotionEvent({ promotionId: promotion.id, eventType: "promotion.paused", eventKey: `promotion:${promotion.id}:commercial-inactive`, payloadJson: { reason: "vendor_or_product_inactive", preserveExistingOnboarding: true } });
        if (result.queued) queued += 1;
        continue;
      }
    }
    const transition = scheduledPromotionTransition({ state: promotion.state, startsAt: promotion.startsAt, endsAt: promotion.endsAt, now });
    if (transition) {
      const result = await enqueuePromotionEvent({ promotionId: promotion.id, eventType: transition, eventKey: `promotion:${promotion.id}:${transition}:schedule`, payloadJson: { scheduledSweep: true } });
      if (result.queued) queued += 1;
    }
    if (promotion.state === "active" && promotion.recruitmentCampaignId) {
      const activated = await db.select({ id: campusRecruitments.id }).from(campusRecruitments)
        .where(and(eq(campusRecruitments.campaignId, promotion.recruitmentCampaignId), eq(campusRecruitments.status, "activated")));
      const staffing = evaluateStaffingProgress({ target: promotion.recruitmentTarget, activated: activated.length, startsAt: promotion.startsAt, endsAt: promotion.endsAt, now, warningPct: promotion.staffingWarningPct });
      if (staffing.targetMet) {
        const result = await enqueuePromotionEvent({ promotionId: promotion.id, eventType: "recruitment.target_met", eventKey: `promotion:${promotion.id}:recruitment-target-met`, payloadJson: { activated: activated.length, target: promotion.recruitmentTarget } });
        if (result.queued) queued += 1;
      } else if (staffing.atRisk) {
        const day = now.toISOString().slice(0, 10);
        const result = await enqueuePromotionEvent({ promotionId: promotion.id, eventType: "recruitment.target_at_risk", eventKey: `promotion:${promotion.id}:recruitment-at-risk:${day}`, payloadJson: { ...staffing, activated: activated.length, target: promotion.recruitmentTarget } });
        if (result.queued) queued += 1;
      }
    }
    if (promotion.state === "active") {
      const capacity = await promotionCapacityForNewDeal(db, promotion.id, 0);
      if ((capacity.remainingBudgetKobo || 0) <= 0 || (capacity.uncommittedEscrowKobo || 0) <= 0) {
        const result = await enqueuePromotionEvent({ promotionId: promotion.id, eventType: "promotion.budget_exhausted", eventKey: `promotion:${promotion.id}:budget-exhausted:${promotion.budgetStoppedAt?.getTime() || now.toISOString().slice(0, 10)}`, payloadJson: { committedKobo: capacity.committedKobo, preserveEarnedPayouts: true } });
        if (result.queued) queued += 1;
      }
    }
  }
  const orchestration = await processPromotionOrchestration();
  return { promotionsEvaluated: rows.length, queued, ...orchestration };
}

export async function createPromotionLink(input: { actor: SalesActor; promotionId: number; origin: string }) {
  assertSalesRole(input.actor, ["rep"]);
  if (!input.actor.repId) throw new TRPCError({ code: "FORBIDDEN", message: "An active representative profile is required" });
  const promotion = await promotionForActor(input.actor, input.promotionId);
  const now = new Date();
  if (promotion.state !== "active" || promotion.startsAt > now || promotion.endsAt <= now) throw new TRPCError({ code: "CONFLICT", message: "Promotion acquisition is not active" });
  const result = await getDb().transaction(async (tx) => {
    const [lockedPromotion] = await tx.select().from(vendorPromotions).where(eq(vendorPromotions.id, promotion.id)).limit(1).for("update");
    const lockedNow = new Date();
    if (!lockedPromotion || lockedPromotion.state !== "active" || lockedPromotion.startsAt > lockedNow || lockedPromotion.endsAt <= lockedNow) throw new TRPCError({ code: "CONFLICT", message: "Promotion acquisition is not active" });
    await assertPromotionCommercialActive(tx, lockedPromotion);
    const [rep] = await tx.select().from(reps).where(eq(reps.id, input.actor.repId!)).limit(1).for("update");
    const [product] = await tx.select().from(products).where(eq(products.id, lockedPromotion.productId)).limit(1);
    if (!rep || rep.status !== "active" || !product || product.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Active representative and product records are required" });
    if (lockedPromotion.campusId && rep.campusId !== lockedPromotion.campusId) throw new TRPCError({ code: "FORBIDDEN", message: "This promotion is outside your campus" });
    await assertCurrentIdentityApproval({ subjectType: "user", subjectId: rep.userId, caseTypes: rep.tier === "campus_lead" ? ["campus_lead_kyc", "representative_kyc"] : ["representative_kyc"] }, tx);
    await assertCurrentStudentAssurance(rep.userId, tx);
    await assertNoFraudHold(tx, rep.id);
    const [{ id }] = await tx.insert(promotionLinks).values({ promotionId: lockedPromotion.id, repId: rep.id, tokenHash: randomReference("pending").slice(-64), expiresAt: lockedPromotion.endsAt }).returning({ id: promotionLinks.id });
    const payload: PromotionTokenPayload = { linkId: id, promotionId: lockedPromotion.id, repId: rep.id, productId: product.id, vendorId: lockedPromotion.vendorId, exp: lockedPromotion.endsAt.getTime() };
    const token = signedToken(JSON.stringify(payload), PROMOTION_LINK_SECRET);
    await tx.update(promotionLinks).set({ tokenHash: promotionTokenHash(token) }).where(eq(promotionLinks.id, id));
    await tx.insert(promotionEvents).values({ promotionId: lockedPromotion.id, actorUserId: input.actor.userId, eventType: "promotion.link_created", metadataJson: { linkId: id, repId: rep.id, signed: true, customerDataInUrl: false } });
    const url = `${input.origin.replace(/\/$/, "")}/p/${encodeURIComponent(token)}`;
    return { linkId: id, url, qr: await QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: "#102a43", light: "#fffdf7" } }), expiresAt: lockedPromotion.endsAt, customerDataInUrl: false };
  });
  return result;
}

export async function createPromotionRecruitmentInvite(input: { actor: SalesActor; promotionId: number; name: string; phone: string; note?: string; consentConfirmed: boolean }) {
  assertSalesRole(input.actor, ["rep"]);
  if (input.actor.tier !== "campus_lead" || !input.actor.repId) throw new TRPCError({ code: "FORBIDDEN", message: "Only an accountable Campus Lead can recruit for this promotion" });
  if (!input.consentConfirmed) throw new TRPCError({ code: "BAD_REQUEST", message: "Confirm the candidate consented to this invitation" });
  const promotion = await promotionForActor(input.actor, input.promotionId);
  const now = new Date();
  if (promotion.state !== "active" || promotion.targetMetAt || !promotion.recruitmentCampaignId || promotion.startsAt > now || promotion.endsAt <= now) throw new TRPCError({ code: "CONFLICT", message: "Recruitment is not accepting new invitations" });
  const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, promotion.recruitmentCampaignId)).limit(1);
  if (!campaign || campaign.state !== "active" || campaign.startsAt > now || campaign.endsAt <= now) throw new TRPCError({ code: "CONFLICT", message: "The linked recruitment campaign is paused, closed, or outside its schedule" });
  const [enrollment] = await getDb().select().from(campaignEnrollments).where(and(eq(campaignEnrollments.campaignId, campaign.id), eq(campaignEnrollments.repId, input.actor.repId))).limit(1);
  if (!enrollment) throw new TRPCError({ code: "FORBIDDEN", message: "You are not assigned to this recruitment campaign" });
  const phoneE164 = normalizePhone(input.phone);
  const invitationToken = createInvitationToken();
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(vendorPromotions).where(eq(vendorPromotions.id, promotion.id)).limit(1).for("update");
    const lockedNow = new Date();
    const [lockedCampaign] = locked ? await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1).for("update") : [];
    if (!locked || !lockedCampaign || locked.state !== "active" || locked.targetMetAt || locked.startsAt > lockedNow || locked.endsAt <= lockedNow || lockedCampaign.state !== "active" || lockedCampaign.startsAt > lockedNow || lockedCampaign.endsAt <= lockedNow) throw new TRPCError({ code: "CONFLICT", message: "Recruitment schedule, target, or promotion state now blocks new invitations" });
    await assertPromotionCommercialActive(tx, locked);
    const [lead] = await tx.select().from(reps).where(eq(reps.id, input.actor.repId!)).limit(1).for("update");
    if (!lead || lead.status !== "active" || lead.tier !== "campus_lead" || (locked.campusId && lead.campusId !== locked.campusId)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An active Campus Lead in the promotion campus is required" });
    await assertCurrentIdentityApproval({ subjectType: "user", subjectId: lead.userId, caseTypes: ["campus_lead_kyc", "representative_kyc"] }, tx);
    await assertCurrentStudentAssurance(lead.userId, tx);
    await assertNoFraudHold(tx, lead.id);
    const activated = await tx.select({ id: campusRecruitments.id }).from(campusRecruitments).where(and(eq(campusRecruitments.campaignId, lockedCampaign.id), eq(campusRecruitments.status, "activated")));
    if (activated.length >= locked.recruitmentTarget) throw new TRPCError({ code: "CONFLICT", message: "Recruitment target now blocks new invitations" });
    const [existing] = await tx.select({ id: campusRecruitments.id }).from(campusRecruitments)
      .where(and(eq(campusRecruitments.leadRepId, input.actor.repId!), eq(campusRecruitments.phoneE164, phoneE164), eq(campusRecruitments.status, "invited"))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This student already has an open invitation" });
    const now = new Date();
    const [{ id }] = await tx.insert(campusRecruitments).values({
      leadRepId: input.actor.repId!,
      campusId: lead.campusId,
      name: input.name,
      phoneE164,
      note: input.note || null,
      source: "vendor_promotion",
      campaignId: campaign.id,
      tokenHash: hashInvitationToken(invitationToken),
      expiresAt: new Date(Math.min(now.getTime() + 7 * 86_400_000, locked.endsAt.getTime())),
      nextFollowUpAt: new Date(now.getTime() + 2 * 86_400_000),
    }).returning({ id: campusRecruitments.id });
    await tx.insert(recruitmentEvents).values({ recruitmentId: id, actorUserId: input.actor.userId, action: "invited_for_vendor_promotion", toStatus: "invited", note: `Consent confirmed for promotion ${locked.promotionKey}` });
    await tx.insert(promotionEvents).values({ promotionId: locked.id, actorUserId: input.actor.userId, eventType: "recruitment.invited", metadataJson: { recruitmentId: id, campaignId: campaign.id, commissionCreated: false } });
    return { recruitmentId: id, campaignId: campaign.id, state: "invited" as const, acceptancePath: `/recruit/accept?token=${encodeURIComponent(invitationToken)}`, commissionCreated: false };
  });
}

export async function recordPromotionConsent(input: {
  actor: SalesActor;
  promotionId: number;
  customerRef: string;
  channel: "email" | "sms" | "whatsapp";
  state: "consented" | "suppressed";
  evidenceRef: string;
  policyVersion: string;
}) {
  assertPromotionWriter(input.actor);
  const promotion = await promotionForActor(input.actor, input.promotionId);
  assertOwnVendor(input.actor, promotion.vendorId);
  if (input.evidenceRef.includes("@") || /(?:\D*\d){7,}/.test(input.evidenceRef)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use an opaque evidence reference, not contact details or identity numbers" });
  const customerRefHash = hashCustomerRef(input.customerRef);
  const now = new Date();
  await getDb().insert(promotionContactConsents).values({
    promotionId: promotion.id,
    customerRefHash,
    channel: input.channel,
    state: input.state,
    evidenceRef: input.evidenceRef,
    policyVersion: input.policyVersion,
    createdByUserId: input.actor.userId,
    updatedAt: now,
  }).onConflictDoUpdate({ target: [promotionContactConsents.promotionId, promotionContactConsents.channel, promotionContactConsents.customerRefHash], set: { state: input.state, evidenceRef: input.evidenceRef, policyVersion: input.policyVersion, updatedAt: now } });
  await getDb().insert(promotionEvents).values({ promotionId: promotion.id, actorUserId: input.actor.userId, eventType: `consent.${input.state}`, metadataJson: { channel: input.channel, evidenceRef: input.evidenceRef, policyVersion: input.policyVersion, rawContactStored: false } });
  return { promotionId: promotion.id, channel: input.channel, state: input.state, rawContactStored: false };
}

export async function requestPromotionDelivery(input: { actor: SalesActor; promotionId: number; channel: "email" | "sms" | "whatsapp"; mode: "sandbox" | "live" }) {
  assertPromotionWriter(input.actor);
  const promotion = await promotionForActor(input.actor, input.promotionId);
  assertOwnVendor(input.actor, promotion.vendorId);
  if (promotion.state !== "active") throw new TRPCError({ code: "CONFLICT", message: "Consented delivery can be requested only for an active promotion" });
  const db = getDb();
  const consents = await db.select().from(promotionContactConsents).where(and(eq(promotionContactConsents.promotionId, promotion.id), eq(promotionContactConsents.channel, input.channel)));
  const consentedCount = consents.filter((row) => row.state === "consented").length;
  const suppressedCount = consents.filter((row) => row.state === "suppressed").length;
  if (!consentedCount) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No currently consented audience exists for this channel" });
  if (input.mode === "live") {
    await assertLiveProviderExecutionAuthorized();
    const [blocked] = await db.insert(promotionDeliveryRequests).values({ promotionId: promotion.id, channel: input.channel, mode: "live", state: "blocked", consentedCount, suppressedCount, requestedByUserId: input.actor.userId, failureReason: "A separately approved live messaging adapter, provider credentials, deliverability and suppression monitoring are required", externalRequestMade: false, processedAt: new Date() }).returning({ id: promotionDeliveryRequests.id });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Live delivery request ${blocked.id} was recorded as blocked. No provider request was made.` });
  }
  const [connection] = await db.select().from(vendorServiceConnections).where(and(eq(vendorServiceConnections.vendorId, promotion.vendorId), eq(vendorServiceConnections.service, "messaging"), eq(vendorServiceConnections.mode, "sandbox"), eq(vendorServiceConnections.state, "verified"))).limit(1);
  if (!connection) {
    await db.insert(promotionDeliveryRequests).values({ promotionId: promotion.id, channel: input.channel, mode: "sandbox", state: "blocked", consentedCount, suppressedCount, requestedByUserId: input.actor.userId, failureReason: "Configure and test the sandbox messaging adapter first", externalRequestMade: false, processedAt: new Date() });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure and test the sandbox messaging adapter before requesting a simulation" });
  }
  const [request] = await db.insert(promotionDeliveryRequests).values({ promotionId: promotion.id, connectionId: connection.id, channel: input.channel, mode: "sandbox", state: "simulated", consentedCount, suppressedCount, requestedByUserId: input.actor.userId, externalRequestMade: false, processedAt: new Date() }).returning({ id: promotionDeliveryRequests.id });
  await db.insert(promotionEvents).values({ promotionId: promotion.id, actorUserId: input.actor.userId, eventType: "delivery.sandbox_simulated", metadataJson: { deliveryRequestId: request.id, channel: input.channel, consentedCount, suppressedCount, externalRequestMade: false } });
  return { deliveryRequestId: request.id, state: "simulated" as const, consentedCount, suppressedCount, externalRequestMade: false, liveDeliveryClaimed: false };
}

export async function listPromotionWorkspace(actor: SalesActor) {
  assertSalesRole(actor, ["rep", "vendor", "ops", "finance", "admin"]);
  const db = getDb();
  let rows = await db.select({ promotion: vendorPromotions, vendorName: vendors.companyName, productName: products.name, productRef: products.vendorRef, campusName: campuses.name }).from(vendorPromotions)
    .innerJoin(vendors, eq(vendorPromotions.vendorId, vendors.id))
    .innerJoin(products, eq(vendorPromotions.productId, products.id))
    .leftJoin(campuses, eq(vendorPromotions.campusId, campuses.id))
    .orderBy(desc(vendorPromotions.updatedAt)).limit(60);
  if (actor.role === "vendor") rows = rows.filter((row) => row.promotion.vendorId === actor.vendorId);
  if (actor.role === "rep") rows = rows.filter((row) => !["draft", "pending_review", "rejected"].includes(row.promotion.state) && (!row.promotion.campusId || row.promotion.campusId === actor.campusId));
  const promotionIds = rows.map((row) => row.promotion.id);
  const campaignIds = rows.map((row) => row.promotion.recruitmentCampaignId).filter((id): id is number => Boolean(id));
  const [rules, timeline, recruitments, links, consents, deliveries, orchestration] = await Promise.all([
    promotionIds.length ? db.select().from(promotionTriggerRules).where(inArray(promotionTriggerRules.promotionId, promotionIds)).orderBy(promotionTriggerRules.id) : [],
    promotionIds.length ? db.select().from(promotionEvents).where(inArray(promotionEvents.promotionId, promotionIds)).orderBy(desc(promotionEvents.createdAt)).limit(300) : [],
    campaignIds.length ? db.select().from(campusRecruitments).where(inArray(campusRecruitments.campaignId, campaignIds)).orderBy(desc(campusRecruitments.invitedAt)).limit(500) : [],
    promotionIds.length ? db.select().from(promotionLinks).where(inArray(promotionLinks.promotionId, promotionIds)) : [],
    promotionIds.length && actor.role !== "rep" ? db.select().from(promotionContactConsents).where(inArray(promotionContactConsents.promotionId, promotionIds)) : [],
    promotionIds.length && actor.role !== "rep" ? db.select().from(promotionDeliveryRequests).where(inArray(promotionDeliveryRequests.promotionId, promotionIds)).orderBy(desc(promotionDeliveryRequests.createdAt)).limit(150) : [],
    promotionIds.length && actor.role !== "rep" ? db.select().from(promotionOrchestrationEvents).where(inArray(promotionOrchestrationEvents.promotionId, promotionIds)).orderBy(desc(promotionOrchestrationEvents.createdAt)).limit(250) : [],
  ]);
  const walletCache = new Map<number, number>();
  const pendingCache = new Map<number, number>();
  const reportRows = [];
  for (const row of rows) {
    const promotion = row.promotion;
    if (!walletCache.has(promotion.vendorId)) {
      const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, promotion.vendorId)).limit(1);
      walletCache.set(promotion.vendorId, wallet?.balanceKobo || 0);
      const pending = await db.select({ amount: deals.vendorCommissionKobo }).from(deals).where(and(eq(deals.vendorId, promotion.vendorId), eq(deals.state, "pending")));
      pendingCache.set(promotion.vendorId, pending.reduce((sum, deal) => sum + deal.amount, 0));
    }
    const attributionRows = await db.select({ id: attributionRecords.id }).from(attributionRecords).where(eq(attributionRecords.promotionId, promotion.id));
    const dealRows = attributionRows.length ? await db.select().from(deals).where(inArray(deals.attributionId, attributionRows.map((item) => item.id))) : [];
    const recruitmentRows = recruitments.filter((item) => item.campaignId === promotion.recruitmentCampaignId);
    const activated = recruitmentRows.filter((item) => item.status === "activated").length;
    const staffing = evaluateStaffingProgress({ target: promotion.recruitmentTarget, activated, startsAt: promotion.startsAt, endsAt: promotion.endsAt, now: new Date(), warningPct: promotion.staffingWarningPct });
    const committedKobo = dealRows.filter((deal) => OPEN_DEAL_STATES.includes(deal.state as typeof OPEN_DEAL_STATES[number])).reduce((sum, deal) => sum + deal.vendorCommissionKobo, 0);
    const escrowBalanceKobo = walletCache.get(promotion.vendorId) || 0;
    const pendingVendorCommitmentsKobo = pendingCache.get(promotion.vendorId) || 0;
    reportRows.push({
      ...row,
      report: {
        recruitment: {
          target: promotion.recruitmentTarget,
          invited: recruitmentRows.filter((item) => item.status === "invited").length,
          accepted: recruitmentRows.filter((item) => item.status === "accepted").length,
          activated,
          ...staffing,
        },
        attributedCustomers: attributionRows.length,
        acceptedActivations: dealRows.filter((deal) => !["void", "clawed_back", "failed"].includes(deal.state)).length,
        confirmedActivations: dealRows.filter((deal) => VERIFIED_DEAL_STATES.includes(deal.state as typeof VERIFIED_DEAL_STATES[number])).length,
        paidActivations: dealRows.filter((deal) => deal.state === "paid").length,
        reversedActivations: dealRows.filter((deal) => ["void", "clawed_back"].includes(deal.state)).length,
        signedLinks: links.filter((link) => link.promotionId === promotion.id).length,
        budget: actor.role === "rep" ? null : {
          capKobo: promotion.budgetCapKobo,
          committedKobo,
          remainingKobo: Math.max(0, promotion.budgetCapKobo - committedKobo),
          escrowBalanceKobo,
          pendingVendorCommitmentsKobo,
          uncommittedEscrowKobo: Math.max(0, escrowBalanceKobo - pendingVendorCommitmentsKobo),
          doubleReserved: false,
        },
      },
      capabilities: {
        canSubmit: ["vendor", "ops", "admin"].includes(actor.role) && ["draft", "rejected"].includes(promotion.state),
        canReview: ["ops", "admin"].includes(actor.role) && promotion.state === "pending_review" && promotion.createdByUserId !== actor.userId,
        canStart: ["ops", "admin"].includes(actor.role) && ["approved", "scheduled"].includes(promotion.state),
        canPause: ["vendor", "ops", "admin"].includes(actor.role) && promotion.state === "active",
        canResume: ["ops", "admin"].includes(actor.role) && ["paused", "budget_exhausted"].includes(promotion.state),
        canEnd: ["vendor", "ops", "admin"].includes(actor.role) && ["approved", "scheduled", "active", "paused", "budget_exhausted"].includes(promotion.state),
        canLink: actor.role === "rep" && promotion.state === "active",
        canRecruit: actor.role === "rep" && actor.tier === "campus_lead" && promotion.state === "active" && !promotion.targetMetAt,
        canConsent: ["vendor", "ops", "admin"].includes(actor.role),
      },
    });
  }
  const visibleRecruitments = actor.role === "rep" && actor.tier === "campus_lead" ? recruitments.filter((item) => item.leadRepId === actor.repId).map((item) => ({ id: item.id, campaignId: item.campaignId, name: item.name, status: item.status, invitedAt: item.invitedAt, acceptedAt: item.acceptedAt, activatedAt: item.activatedAt, nextFollowUpAt: item.nextFollowUpAt })) : [];
  const options = ["vendor", "ops", "admin"].includes(actor.role) ? {
    products: await db.select({ id: products.id, name: products.name, vendorId: products.vendorId, vendorRef: products.vendorRef }).from(products)
      .where(and(eq(products.status, "active"), ...(actor.role === "vendor" ? [eq(products.vendorId, actor.vendorId!)] : []))).orderBy(products.name),
    campuses: await db.select({ id: campuses.id, name: campuses.name }).from(campuses).orderBy(campuses.name),
  } : { products: [], campuses: [] };
  const financialVisible = actor.role !== "rep";
  return {
    promotions: reportRows,
    rules: actor.role === "rep" ? [] : rules,
    events: actor.role === "rep" ? timeline.map((item) => ({ id: item.id, promotionId: item.promotionId, eventType: item.eventType, createdAt: item.createdAt, metadataJson: {} })) : timeline,
    orchestration: actor.role === "rep" ? [] : orchestration,
    recruitments: visibleRecruitments,
    deliveries: actor.role === "rep" ? [] : deliveries,
    consentMetrics: actor.role === "rep" ? [] : promotionIds.map((promotionId) => ({
      promotionId,
      consented: consents.filter((item) => item.promotionId === promotionId && item.state === "consented").length,
      suppressed: consents.filter((item) => item.promotionId === promotionId && item.state === "suppressed").length,
    })),
    options,
    viewer: { role: actor.role, isCampusLead: actor.tier === "campus_lead" },
    metrics: {
      total: rows.length,
      active: rows.filter((row) => row.promotion.state === "active").length,
      awaitingReview: rows.filter((row) => row.promotion.state === "pending_review").length,
      confirmedActivations: reportRows.reduce((sum, row) => sum + row.report.confirmedActivations, 0),
      recruitmentTarget: reportRows.reduce((sum, row) => sum + row.report.recruitment.target, 0),
      activatedRecruits: reportRows.reduce((sum, row) => sum + row.report.recruitment.activated, 0),
      committedKobo: financialVisible ? reportRows.reduce((sum, row) => sum + (row.report.budget?.committedKobo || 0), 0) : null,
    },
    boundary: "Vendor promotions trigger linked campus recruitment and signed first-touch acquisition. Confirmed reporting uses vendor-verified deals only. Recruitment alone earns no commission; budget caps do not reserve escrow or alter earned payouts. External delivery is consent- and suppression-checked, sandbox-simulated only unless a separately approved live provider exists.",
  };
}
