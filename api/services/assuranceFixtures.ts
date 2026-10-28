import { and, eq } from "drizzle-orm";
import { enrollmentAttestations } from "@db/schema";
import { getDb } from "../queries/connection";
import { currentEnrollmentAttestation, reviewEnrollmentAttestation, submitEnrollmentAttestation } from "./studentAssurance";

export async function completeSyntheticEnrollment(input: { userId: number; reviewerUserId: number }) {
  const current = await currentEnrollmentAttestation(input.userId);
  if (current?.providerMode === "sandbox") return { attestation: current, synthetic: true, alreadyVerified: true };
  const [submitted] = await getDb().select().from(enrollmentAttestations)
    .where(and(eq(enrollmentAttestations.userId, input.userId), eq(enrollmentAttestations.state, "submitted"))).limit(1);
  const attestation = submitted || await submitEnrollmentAttestation({
    userId: input.userId,
    providerName: "institution-synthetic",
    providerMode: "sandbox",
    attestationReference: `synthetic-enrollment-${crypto.randomUUID()}`,
    academicTerm: "sandbox-current-term",
    verificationMethod: "institution_provider",
    requestedValidUntil: new Date(Date.now() + 120 * 86_400_000),
  });
  const reviewed = await reviewEnrollmentAttestation({
    caseId: attestation.id,
    actorUserId: input.reviewerUserId,
    decision: "verify",
    reason: "Synthetic enrollment control fixture for sandbox acceptance; no institution outcome is implied.",
  });
  return { attestation: reviewed, synthetic: true, alreadyVerified: false, institutionVerified: false };
}
