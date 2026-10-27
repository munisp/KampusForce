import { and, eq, isNull } from "drizzle-orm";
import {
  auditLogs,
  campusLeadAssignments,
  campusRecruitments,
  campuses,
  deals,
  notifications,
  reps,
  users,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { rankTopDecile } from "./overrides";

export async function campusLeadRankings() {
  const db = getDb();
  const allReps = await db.select({ rep: reps, user: users, campus: campuses }).from(reps)
    .innerJoin(users, eq(reps.userId, users.id)).innerJoin(campuses, eq(reps.campusId, campuses.id));
  const allDeals = await db.select().from(deals);
  const campusIds = [...new Set(allReps.map((row) => row.rep.campusId))];
  return campusIds.flatMap((campusId) => {
    const campusReps = allReps.filter((row) => row.rep.campusId === campusId && row.rep.status === "active");
    const ranked = rankTopDecile(campusReps.map((row) => {
      const repDeals = allDeals.filter((deal) => deal.repId === row.rep.id && ["confirmed", "payable", "paid"].includes(deal.state));
      return {
        repId: row.rep.id,
        campusId,
        confirmedCommissionKobo: repDeals.reduce((sum, deal) => sum + deal.repCommissionKobo, 0),
        activationCount: repDeals.length,
      };
    }));
    return ranked.map((ranking) => ({
      ...ranking,
      rep: campusReps.find((row) => row.rep.id === ranking.repId)!.rep,
      user: campusReps.find((row) => row.rep.id === ranking.repId)!.user,
    }));
  });
}

export function leadDemotionReasons(input?: {
  status: "pending" | "active" | "held" | "suspended";
  contractorAgreementSignedAt: Date | null;
  topDecileEligible: boolean;
}) {
  if (!input) return ["not_active_in_campus_ranking"];
  const reasons: string[] = [];
  if (input.status !== "active") reasons.push("rep_not_active");
  if (!input.topDecileEligible) reasons.push("outside_campus_top_decile");
  if (!input.contractorAgreementSignedAt) reasons.push("contractor_agreement_missing");
  return reasons;
}

export async function recalculateCampusLeadEligibility(actorUserId?: number) {
  const db = getDb();
  const rankings = await campusLeadRankings();
  const currentLeads = await db.select().from(reps).where(eq(reps.tier, "campus_lead"));
  const now = new Date();
  const results: { repId: number; status: "retained" | "demoted"; reasons: string[] }[] = [];

  for (const lead of currentLeads) {
    const ranking = rankings.find((row) => row.repId === lead.id);
    const reasons = leadDemotionReasons(ranking ? {
      status: ranking.rep.status,
      contractorAgreementSignedAt: ranking.rep.contractorAgreementSignedAt,
      topDecileEligible: ranking.topDecileEligible,
    } : undefined);
    if (!reasons.length) {
      await db.update(reps).set({ leadEligibilitySyncedAt: now }).where(eq(reps.id, lead.id));
      results.push({ repId: lead.id, status: "retained", reasons });
      continue;
    }

    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(reps).where(eq(reps.id, lead.id)).limit(1).for("update");
      if (!locked || locked.tier !== "campus_lead") return;
      const restoredTier = locked.leadPreviousTier && locked.leadPreviousTier !== "campus_lead"
        ? locked.leadPreviousTier
        : "starter";
      const reason = reasons.join(",");
      await tx.update(reps).set({
        tier: restoredTier,
        leadPreviousTier: null,
        leadDemotedAt: now,
        leadDemotionReason: reason,
        leadEligibilitySyncedAt: now,
      }).where(eq(reps.id, locked.id));
      const revokedAssignments = await tx.update(campusLeadAssignments).set({ revokedAt: now })
        .where(and(eq(campusLeadAssignments.leadRepId, locked.id), isNull(campusLeadAssignments.revokedAt)))
        .returning({ id: campusLeadAssignments.id });
      const revokedInvites = await tx.update(campusRecruitments).set({
        status: "revoked",
        revokedAt: now,
        revokedByUserId: actorUserId,
      }).where(and(
        eq(campusRecruitments.leadRepId, locked.id),
        eq(campusRecruitments.status, "invited"),
        isNull(campusRecruitments.revokedAt),
      )).returning({ id: campusRecruitments.id });
      await tx.insert(auditLogs).values({
        actorUserId,
        action: "campus_lead.demoted",
        entityType: "rep",
        entityId: String(locked.id),
        metadataJson: {
          reasons,
          restoredTier,
          revokedAssignments: revokedAssignments.length,
          revokedOpenInvites: revokedInvites.length,
          historicalOverrides: "preserved",
          futureOverrideAccrual: "disabled",
        },
      });
      await tx.insert(notifications).values({
        userId: locked.userId,
        type: "campus_lead_eligibility",
        title: "Campus Lead designation updated",
        body: `Your Campus Lead designation was removed: ${reasons.join(", ")}. Historical overrides are preserved; future team management and override accrual are disabled.`,
        href: "/rep/team",
        entityType: "rep",
        entityId: String(locked.id),
      });
    });
    results.push({ repId: lead.id, status: "demoted", reasons });
  }

  await db.insert(auditLogs).values({
    actorUserId,
    action: "campus_lead.eligibility_recalculated",
    entityType: "campus_lead_batch",
    entityId: crypto.randomUUID(),
    metadataJson: {
      reviewed: currentLeads.length,
      retained: results.filter((row) => row.status === "retained").length,
      demoted: results.filter((row) => row.status === "demoted").length,
      automaticPromotion: false,
    },
  });
  return {
    reviewed: currentLeads.length,
    retained: results.filter((row) => row.status === "retained").length,
    demoted: results.filter((row) => row.status === "demoted").length,
    results,
  };
}
