import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { assuranceEvents, fraudCases } from "@db/schema";
import { getDb } from "../queries/connection";
import { reviewFraudCaseInTransaction } from "./fraud";

export type AssuranceDatabase = ReturnType<typeof getDb>;
export type AssuranceTransaction = Parameters<Parameters<AssuranceDatabase["transaction"]>[0]>[0];
export type AssuranceExecutor = AssuranceDatabase | AssuranceTransaction;

export function assuranceReferenceHash(domain: string, provider: string, value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 256) throw new Error("A bounded provider reference of 8–256 characters is required");
  const secret = process.env.KF_IDENTITY_TOKENIZATION_SECRET || "kampusforce-sandbox-identity-tokenization-not-for-production";
  if (secret.length < 32) throw new Error("Assurance tokenization requires the configured identity secret");
  return createHmac("sha256", secret).update(`kampusforce:assurance:${domain}:v1:${provider.trim().toLowerCase()}:${normalized}`).digest("hex");
}

export async function recordAssuranceEvent(
  tx: AssuranceTransaction,
  input: {
    caseType: "enrollment" | "duplicate_identity" | "activation_risk" | "vendor_assurance" | "biometric_evaluation";
    caseId: number;
    actorUserId: number | null;
    action: string;
    fromState?: string | null;
    toState?: string | null;
    payload?: Record<string, string | number | boolean | null>;
  },
) {
  await tx.insert(assuranceEvents).values({
    caseType: input.caseType,
    caseId: input.caseId,
    actorUserId: input.actorUserId,
    action: input.action,
    fromState: input.fromState || null,
    toState: input.toState || null,
    payload: input.payload || {},
  });
}

export async function resolveLinkedFraudCase(
  tx: AssuranceTransaction,
  fraudCaseId: number | null,
  actorUserId: number,
  decision: "release" | "uphold",
  note: string,
) {
  if (!fraudCaseId) return;
  const [linked] = await tx.select().from(fraudCases).where(eq(fraudCases.id, fraudCaseId)).limit(1).for("update");
  if (linked && ["open", "appeal_open"].includes(linked.state)) {
    await reviewFraudCaseInTransaction(tx, { caseId: fraudCaseId, actorUserId, decision, note, conductAction: "strike" });
  }
}
