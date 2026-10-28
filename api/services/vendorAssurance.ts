import { and, eq, inArray } from "drizzle-orm";
import { vendorAssuranceAudits, vendorWebhookCredentials, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { randomReference } from "./security";
import { reconcileVendorSample } from "./assurancePolicy";
import { assuranceReferenceHash, recordAssuranceEvent } from "./assuranceCommon";

export async function recordVendorAssuranceAudit(input: {
  vendorId: number;
  actorUserId: number;
  periodStart: Date;
  periodEnd: Date;
  sampleSize: number;
  verifiedOutcomes: number;
  mismatches: number;
  evidenceReference: string;
  reviewReason: string;
}) {
  if (input.periodEnd <= input.periodStart) throw new Error("Vendor assurance period end must follow its start");
  const assessment = reconcileVendorSample(input);
  const evidenceHash = assuranceReferenceHash("vendor-outcome-sample", String(input.vendorId), input.evidenceReference);
  return getDb().transaction(async (tx) => {
    const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1).for("update");
    if (!vendor) throw new Error("Vendor not found");
    const [audit] = await tx.insert(vendorAssuranceAudits).values({
      auditRef: randomReference("vendor_audit"), vendorId: input.vendorId, periodStart: input.periodStart, periodEnd: input.periodEnd,
      sampleSize: input.sampleSize, verifiedOutcomes: input.verifiedOutcomes, mismatches: input.mismatches,
      state: assessment.state, evidenceHash, reviewerUserId: input.actorUserId, reviewReason: input.reviewReason, reviewedAt: new Date(),
    }).returning();
    let suspendedCredentialIds: number[] = [];
    if (assessment.state === "failed") {
      const credentials = await tx.update(vendorWebhookCredentials).set({ state: "revoked", revokedAt: new Date() })
        .where(and(
          eq(vendorWebhookCredentials.vendorId, input.vendorId),
          inArray(vendorWebhookCredentials.state, ["active", "retiring"]),
        )).returning({ id: vendorWebhookCredentials.id });
      suspendedCredentialIds = credentials.map((item) => item.id);
      await tx.update(vendors).set({ status: "paused" }).where(eq(vendors.id, vendor.id));
    }
    await recordAssuranceEvent(tx, {
      caseType: "vendor_assurance", caseId: audit.id, actorUserId: input.actorUserId, action: `vendor_assurance.${assessment.state}`, toState: assessment.state,
      payload: { sampleSize: input.sampleSize, verifiedOutcomes: input.verifiedOutcomes, mismatches: input.mismatches, unresolved: assessment.unresolved, vendorPaused: assessment.state === "failed", suspendedCredentialCount: suspendedCredentialIds.length, existingFinancialHistoryChanged: false, externalOutcomesIndependentlyVerified: false },
    });
    return { audit, suspendedCredentialIds, vendorStatus: assessment.state === "failed" ? "paused" as const : vendor.status, automaticReactivation: false, externalOutcomesIndependentlyVerified: false };
  });
}
