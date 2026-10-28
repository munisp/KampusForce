import { and, eq, gt, inArray } from "drizzle-orm";
import { biometricEvaluations, identityEvidenceMetadata } from "@db/schema";
import { getDb } from "../queries/connection";
import { randomReference } from "./security";
import { biometricEvaluationValid, MAX_BIOMETRIC_EVALUATION_DAYS } from "./assurancePolicy";
import { assuranceReferenceHash, recordAssuranceEvent, type AssuranceExecutor } from "./assuranceCommon";

const db = () => getDb();

export async function recordBiometricEvaluation(input: {
  actorUserId: number;
  providerName: string;
  providerMode: "sandbox" | "live";
  kind: "pad" | "injection" | "deepfake" | "demographic";
  modelVersion: string;
  evidenceReference: string;
  decision: "approved" | "rejected";
  validUntil: Date;
  reviewReason: string;
}) {
  const now = new Date();
  if (input.validUntil <= now || input.validUntil.getTime() - now.getTime() > MAX_BIOMETRIC_EVALUATION_DAYS * 86_400_000) {
    throw new Error("Biometric evaluation validity must be future-dated and no more than 365 days");
  }
  const evidenceHash = assuranceReferenceHash("biometric-evaluation", `${input.providerName}:${input.modelVersion}:${input.kind}`, input.evidenceReference);
  return db().transaction(async (tx) => {
    const [evaluation] = await tx.insert(biometricEvaluations).values({
      evaluationRef: randomReference("biometric_eval"), providerName: input.providerName.trim(), providerMode: input.providerMode,
      kind: input.kind, modelVersion: input.modelVersion.trim(), evidenceHash, state: input.decision,
      validUntil: input.validUntil, reviewerUserId: input.actorUserId, reviewReason: input.reviewReason,
    }).returning();
    await recordAssuranceEvent(tx, {
      caseType: "biometric_evaluation", caseId: evaluation.id, actorUserId: input.actorUserId, action: `biometric_evaluation.${input.decision}`, toState: input.decision,
      payload: { kind: input.kind, providerMode: input.providerMode, validUntil: input.validUntil.toISOString(), certificationImplied: false, rawBiometricStored: false },
    });
    return { ...evaluation, certificationImplied: false };
  });
}

export async function expireBiometricEvaluations() {
  const due = await db().select().from(biometricEvaluations).where(and(eq(biometricEvaluations.state, "approved"), gt(biometricEvaluations.validUntil, new Date(0)))).limit(1000);
  let expired = 0;
  for (const item of due) {
    if (biometricEvaluationValid(item)) continue;
    await db().transaction(async (tx) => {
      const changed = await tx.update(biometricEvaluations).set({ state: "expired", updatedAt: new Date() }).where(and(eq(biometricEvaluations.id, item.id), eq(biometricEvaluations.state, "approved"))).returning({ id: biometricEvaluations.id });
      if (!changed.length) return;
      expired += 1;
      await recordAssuranceEvent(tx, { caseType: "biometric_evaluation", caseId: item.id, actorUserId: null, action: "biometric_evaluation.expired", fromState: "approved", toState: "expired", payload: { liveApprovalBlocked: true } });
    });
  }
  return { expired };
}

export async function assertLiveBiometricEvaluationCoverage(caseId: number, executor: AssuranceExecutor = db()) {
  const evidence = await executor.select().from(identityEvidenceMetadata)
    .where(and(eq(identityEvidenceMetadata.caseId, caseId), inArray(identityEvidenceMetadata.kind, ["liveness", "deepfake"]), eq(identityEvidenceMetadata.state, "passed")));
  const missing: string[] = [];
  for (const item of evidence) {
    if (!item.modelVersion) {
      missing.push(`${item.kind}:model_version`);
      continue;
    }
    const kinds = item.kind === "liveness" ? ["pad", "injection", "demographic"] as const : ["deepfake", "demographic"] as const;
    for (const kind of kinds) {
      const [evaluation] = await executor.select().from(biometricEvaluations).where(and(
        eq(biometricEvaluations.providerName, item.provider), eq(biometricEvaluations.modelVersion, item.modelVersion),
        eq(biometricEvaluations.providerMode, "live"), eq(biometricEvaluations.kind, kind),
        eq(biometricEvaluations.state, "approved"), gt(biometricEvaluations.validUntil, new Date()),
      )).limit(1);
      if (!evaluation) missing.push(`${item.kind}:${kind}`);
    }
  }
  if (!evidence.length) missing.push("liveness_and_deepfake_evidence");
  if (missing.length) throw new Error(`Current independent biometric evaluation evidence is missing: ${[...new Set(missing)].join(", ")}`);
  return { covered: true, evidenceProviders: new Set(evidence.map((item) => `${item.provider}:${item.modelVersion}`)).size };
}
