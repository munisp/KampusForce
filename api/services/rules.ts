import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, commissionRuleDrafts, commissionRules } from "@db/schema";
import { getDb } from "../queries/connection";

export { calculateRuleDryRun } from "./ruleMath";

export async function publishRuleDraft(actorUserId: number, vendorId: number, draftId: number) {
  return getDb().transaction(async (tx) => {
    const [draft] = await tx.select().from(commissionRuleDrafts)
      .where(and(eq(commissionRuleDrafts.id, draftId), eq(commissionRuleDrafts.vendorId, vendorId)))
      .limit(1).for("update");
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Rule dry run not found" });
    if (draft.state !== "draft" || draft.expiresAt <= new Date()) {
      if (draft.state === "draft") await tx.update(commissionRuleDrafts).set({ state: "expired" }).where(eq(commissionRuleDrafts.id, draft.id));
      throw new TRPCError({ code: "BAD_REQUEST", message: "This dry run is no longer publishable. Run it again." });
    }
    const existing = await tx.select().from(commissionRules).where(eq(commissionRules.productId, draft.productId)).orderBy(desc(commissionRules.version)).for("update");
    const nextVersion = (existing[0]?.version || 0) + 1;
    const now = new Date();
    await tx.update(commissionRules).set({ supersededAt: now }).where(and(eq(commissionRules.productId, draft.productId), isNull(commissionRules.supersededAt)));
    const [{ id: ruleId }] = await tx.insert(commissionRules).values({
      productId: draft.productId,
      version: nextVersion,
      basis: draft.basis,
      pctBps: draft.pctBps,
      flatAmountKobo: draft.flatAmountKobo,
      triggerEvent: draft.triggerEvent,
      recurrenceMonths: draft.recurrenceMonths,
      recurrenceIntervalMonths: draft.recurrenceIntervalMonths,
      confirmDays: draft.confirmDays,
      clawbackDays: draft.clawbackDays,
      activationCapPerRepDay: draft.activationCapPerRepDay,
      publishedAt: now,
    }).returning({ id: commissionRules.id });
    await tx.update(commissionRuleDrafts).set({ state: "published", publishedRuleId: ruleId }).where(eq(commissionRuleDrafts.id, draft.id));
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "commission_rule.published",
      entityType: "commission_rule",
      entityId: String(ruleId),
      metadataJson: { productId: draft.productId, draftId: draft.id, version: nextVersion, supersededRuleIds: existing.filter((rule) => !rule.supersededAt).map((rule) => rule.id) },
    });
    return { ruleId, draftId: draft.id, productId: draft.productId, version: nextVersion, publishedAt: now };
  });
}
