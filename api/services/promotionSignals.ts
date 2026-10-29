import { and, eq, inArray } from "drizzle-orm";
import {
  attributionRecords,
  campusRecruitments,
  deals,
  promotionOrchestrationEvents,
  vendorPromotions,
} from "@db/schema";
import { getDb } from "../queries/connection";
import type { PromotionEventType } from "./promotionPolicy";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbClient = Database | Transaction;

export async function enqueuePromotionEvent(input: {
  promotionId: number;
  eventType: PromotionEventType;
  eventKey: string;
  actorUserId?: number | null;
  payloadJson?: Record<string, unknown>;
}, client: DbClient = getDb()) {
  const inserted = await client.insert(promotionOrchestrationEvents).values({
    promotionId: input.promotionId,
    eventType: input.eventType,
    eventKey: input.eventKey,
    actorUserId: input.actorUserId || null,
    payloadJson: input.payloadJson || {},
  }).onConflictDoNothing().returning({ id: promotionOrchestrationEvents.id });
  return { queued: inserted.length > 0, eventId: inserted[0]?.id || null };
}

export async function signalPromotionActivationConfirmed(dealId: number, actorUserId?: number, client: DbClient = getDb()) {
  const [row] = await client.select({ deal: deals, attribution: attributionRecords }).from(deals)
    .innerJoin(attributionRecords, eq(deals.attributionId, attributionRecords.id))
    .where(eq(deals.id, dealId)).limit(1);
  if (!row?.attribution.promotionId) return { queued: false, reason: "not_promotion_attributed" as const };
  return enqueuePromotionEvent({
    promotionId: row.attribution.promotionId,
    eventType: "activation.confirmed",
    eventKey: `activation-confirmed:${dealId}`,
    actorUserId,
    payloadJson: { dealId, verifiedOutcome: true },
  }, client);
}

export async function signalPromotionRecruitmentProgress(campaignId: number | null, actorUserId?: number, client: DbClient = getDb()) {
  if (!campaignId) return { queued: false, reason: "not_promotion_recruitment" as const };
  const [promotion] = await client.select().from(vendorPromotions).where(eq(vendorPromotions.recruitmentCampaignId, campaignId)).limit(1);
  if (!promotion || ["completed", "rejected"].includes(promotion.state)) return { queued: false, reason: "promotion_closed" as const };
  const activated = await client.select({ id: campusRecruitments.id }).from(campusRecruitments)
    .where(and(eq(campusRecruitments.campaignId, campaignId), eq(campusRecruitments.status, "activated")));
  if (activated.length < promotion.recruitmentTarget) return { queued: false, reason: "target_not_met" as const, activated: activated.length };
  return enqueuePromotionEvent({
    promotionId: promotion.id,
    eventType: "recruitment.target_met",
    eventKey: `promotion:${promotion.id}:recruitment-target-met`,
    actorUserId,
    payloadJson: { campaignId, activated: activated.length, target: promotion.recruitmentTarget, preserveExistingOnboarding: true },
  }, client);
}

export async function activePromotionCommitmentKobo(promotionId: number, client: DbClient = getDb()) {
  const rows = await client.select({ amount: deals.vendorCommissionKobo }).from(deals)
    .innerJoin(attributionRecords, eq(deals.attributionId, attributionRecords.id))
    .where(and(
      eq(attributionRecords.promotionId, promotionId),
      inArray(deals.state, ["pending", "confirmed", "payable", "paid", "disputed"]),
    ));
  return rows.reduce((sum, row) => sum + row.amount, 0);
}
