import { and, desc, eq, gt, inArray, lte, or } from "drizzle-orm";
import {
  duplicateIdentityCases,
  enrollmentAttestations,
  identityLinkages,
  reps,
  users,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { randomReference } from "./security";
import { createAssuranceFraudCase } from "./fraud";
import { enrollmentValidityWindowValid } from "./assurancePolicy";
import {
  assuranceReferenceHash,
  recordAssuranceEvent,
  resolveLinkedFraudCase,
  type AssuranceExecutor,
} from "./assuranceCommon";

const db = () => getDb();

export async function currentEnrollmentAttestation(userId: number, executor: AssuranceExecutor = db()) {
  const [attestation] = await executor.select().from(enrollmentAttestations)
    .where(and(eq(enrollmentAttestations.userId, userId), eq(enrollmentAttestations.state, "verified"), gt(enrollmentAttestations.validUntil, new Date())))
    .orderBy(desc(enrollmentAttestations.validUntil)).limit(1);
  return attestation || null;
}

export async function studentAssurancePreflight(userId: number, executor: AssuranceExecutor = db()) {
  const enrollment = await currentEnrollmentAttestation(userId, executor);
  const duplicates = await executor.select({ id: duplicateIdentityCases.id }).from(duplicateIdentityCases)
    .where(and(or(eq(duplicateIdentityCases.userId, userId), eq(duplicateIdentityCases.matchedUserId, userId)), inArray(duplicateIdentityCases.state, ["open", "confirmed"]))).limit(1);
  return {
    eligible: !!enrollment && duplicates.length === 0,
    enrollment,
    duplicateReviewOpen: duplicates.length > 0,
    reason: !enrollment ? "Current institution enrollment attestation is required" : duplicates.length ? "Duplicate-identity review must be cleared" : null,
  };
}

export async function assertCurrentStudentAssurance(userId: number, executor: AssuranceExecutor = db()) {
  const result = await studentAssurancePreflight(userId, executor);
  if (!result.eligible) throw new Error(result.reason || "Student assurance preflight failed");
  return result.enrollment!;
}

export async function submitEnrollmentAttestation(input: {
  userId: number;
  providerName: string;
  providerMode: "sandbox" | "live";
  attestationReference: string;
  academicTerm: string;
  verificationMethod: "institution_provider" | "institution_document" | "student_record_provider";
  requestedValidUntil: Date;
}) {
  return db().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1).for("update");
    const [rep] = await tx.select().from(reps).where(eq(reps.userId, input.userId)).limit(1);
    if (!user || user.role !== "rep" || !rep?.campusId) throw new Error("A representative campus profile is required");
    const [pending] = await tx.select({ id: enrollmentAttestations.id }).from(enrollmentAttestations)
      .where(and(eq(enrollmentAttestations.userId, input.userId), eq(enrollmentAttestations.state, "submitted"))).limit(1);
    if (pending) throw new Error("An enrollment attestation is already awaiting independent review");
    if (!enrollmentValidityWindowValid(new Date(), input.requestedValidUntil)) throw new Error("Enrollment validity must be future-dated and no more than 240 days");
    const attestationHash = assuranceReferenceHash("enrollment", input.providerName, input.attestationReference);
    const [attestation] = await tx.insert(enrollmentAttestations).values({
      caseRef: randomReference("enr"),
      userId: input.userId,
      campusId: rep.campusId,
      providerMode: input.providerMode,
      providerName: input.providerName.trim(),
      attestationHash,
      academicTerm: input.academicTerm.trim(),
      verificationMethod: input.verificationMethod,
      requestedValidUntil: input.requestedValidUntil,
    }).returning();
    await recordAssuranceEvent(tx, {
      caseType: "enrollment", caseId: attestation.id, actorUserId: input.userId, action: "enrollment.attestation_submitted", toState: "submitted",
      payload: { providerMode: input.providerMode, providerName: attestation.providerName, academicTerm: attestation.academicTerm, verificationMethod: attestation.verificationMethod, rawAcademicIdentifierStored: false },
    });
    return attestation;
  });
}

export async function reviewEnrollmentAttestation(input: {
  caseId: number;
  actorUserId: number;
  decision: "verify" | "reject" | "revoke";
  reason: string;
}) {
  return db().transaction(async (tx) => {
    const [attestation] = await tx.select().from(enrollmentAttestations).where(eq(enrollmentAttestations.id, input.caseId)).limit(1).for("update");
    if (!attestation) throw new Error("Enrollment attestation not found");
    if (attestation.userId === input.actorUserId) throw new Error("Independent enrollment review is required");
    const nextState = input.decision === "verify" ? "verified" : input.decision === "reject" ? "rejected" : "revoked";
    if (input.decision === "revoke") {
      if (attestation.state !== "verified") throw new Error("Only a verified enrollment attestation can be revoked");
    } else if (attestation.state !== "submitted") {
      throw new Error("Only a submitted enrollment attestation can be reviewed");
    }
    if (nextState === "verified" && !enrollmentValidityWindowValid(attestation.submittedAt, attestation.requestedValidUntil)) {
      throw new Error("Requested enrollment validity is expired or exceeds policy");
    }
    const [updated] = await tx.update(enrollmentAttestations).set({
      state: nextState,
      validUntil: nextState === "verified" ? attestation.requestedValidUntil : attestation.validUntil,
      reviewedByUserId: input.actorUserId,
      reviewedAt: new Date(),
      reviewReason: input.reason,
      updatedAt: new Date(),
    }).where(eq(enrollmentAttestations.id, attestation.id)).returning();
    await recordAssuranceEvent(tx, {
      caseType: "enrollment", caseId: attestation.id, actorUserId: input.actorUserId, action: `enrollment.${nextState}`, fromState: attestation.state, toState: nextState,
      payload: { independentReview: true, externallyVerifiedByPlatform: false, validUntil: updated.validUntil?.toISOString() || null },
    });
    return updated;
  });
}

export async function expireEnrollmentAttestations() {
  const due = await db().select().from(enrollmentAttestations)
    .where(and(eq(enrollmentAttestations.state, "verified"), lte(enrollmentAttestations.validUntil, new Date()))).limit(500);
  let expired = 0;
  for (const item of due) {
    await db().transaction(async (tx) => {
      const changed = await tx.update(enrollmentAttestations).set({ state: "expired", updatedAt: new Date() })
        .where(and(eq(enrollmentAttestations.id, item.id), eq(enrollmentAttestations.state, "verified"))).returning({ id: enrollmentAttestations.id });
      if (!changed.length) return;
      expired += 1;
      await recordAssuranceEvent(tx, { caseType: "enrollment", caseId: item.id, actorUserId: null, action: "enrollment.expired", fromState: "verified", toState: "expired", payload: { revalidationRequired: true } });
    });
  }
  return { due: due.length, expired };
}

export async function registerProviderIdentityLinkage(input: {
  userId: number;
  actorUserId: number;
  providerName: string;
  providerMode: "sandbox" | "live";
  providerSubjectToken: string;
}) {
  return db().transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1).for("update");
    if (!target) throw new Error("Linkage subject not found");
    const tokenHash = assuranceReferenceHash("provider-subject", input.providerName, input.providerSubjectToken);
    const existing = await tx.select().from(identityLinkages)
      .where(and(eq(identityLinkages.providerName, input.providerName.trim()), eq(identityLinkages.tokenHash, tokenHash))).for("update");
    const own = existing.find((item) => item.userId === input.userId);
    if (own) return { linkage: own, duplicateCase: null, idempotent: true };
    const [linkage] = await tx.insert(identityLinkages).values({
      userId: input.userId, providerName: input.providerName.trim(), providerMode: input.providerMode, tokenHash,
    }).returning();
    const matched = existing.find((item) => item.userId !== input.userId);
    if (!matched) {
      await recordAssuranceEvent(tx, { caseType: "duplicate_identity", caseId: linkage.id, actorUserId: input.actorUserId, action: "identity.linkage_recorded", payload: { collisionDetected: false, providerMode: input.providerMode, rawProviderTokenStored: false } });
      return { linkage, duplicateCase: null, idempotent: false };
    }
    const [duplicateCase] = await tx.insert(duplicateIdentityCases).values({
      caseRef: randomReference("dup"), userId: input.userId, matchedUserId: matched.userId, linkageTokenHash: tokenHash, providerName: input.providerName.trim(),
    }).returning();
    const subjectReps = await tx.select().from(reps).where(inArray(reps.userId, [input.userId, matched.userId])).for("update");
    const subjectRep = subjectReps.find((rep) => rep.userId === input.userId);
    const matchedRep = subjectReps.find((rep) => rep.userId === matched.userId);
    const note = `Provider-subject linkage collision ${duplicateCase.caseRef}; human review required. This signal does not prove fraud.`;
    const fraudCase = subjectRep ? await createAssuranceFraudCase(tx, { repId: subjectRep.id, kind: "duplicate_identity_signal", reason: note, evidenceJson: { duplicateCaseRef: duplicateCase.caseRef, signalOnly: true, rawProviderTokenStored: false }, actorUserId: input.actorUserId }) : null;
    const matchedFraudCase = matchedRep ? await createAssuranceFraudCase(tx, { repId: matchedRep.id, kind: "duplicate_identity_signal", reason: note, evidenceJson: { duplicateCaseRef: duplicateCase.caseRef, signalOnly: true, rawProviderTokenStored: false }, actorUserId: input.actorUserId }) : null;
    const [updated] = await tx.update(duplicateIdentityCases).set({ fraudCaseId: fraudCase?.fraudCase.id || null, matchedFraudCaseId: matchedFraudCase?.fraudCase.id || null }).where(eq(duplicateIdentityCases.id, duplicateCase.id)).returning();
    await recordAssuranceEvent(tx, { caseType: "duplicate_identity", caseId: updated.id, actorUserId: input.actorUserId, action: "duplicate_identity.collision_detected", toState: "open", payload: { payoutHoldCreated: !!(fraudCase || matchedFraudCase), signalProvesFraud: false, providerMode: input.providerMode } });
    return { linkage, duplicateCase: updated, idempotent: false };
  });
}

export async function reviewDuplicateIdentityCase(input: { caseId: number; actorUserId: number; decision: "clear" | "confirm"; reason: string }) {
  return db().transaction(async (tx) => {
    const [item] = await tx.select().from(duplicateIdentityCases).where(eq(duplicateIdentityCases.id, input.caseId)).limit(1).for("update");
    if (!item) throw new Error("Duplicate-identity case not found");
    if (item.state !== "open") throw new Error("Only an open duplicate-identity case can be reviewed");
    if ([item.userId, item.matchedUserId].includes(input.actorUserId)) throw new Error("Subjects cannot review their own duplicate-identity case");
    const state = input.decision === "clear" ? "cleared" : "confirmed";
    await resolveLinkedFraudCase(tx, item.fraudCaseId, input.actorUserId, input.decision === "clear" ? "release" : "uphold", input.reason);
    await resolveLinkedFraudCase(tx, item.matchedFraudCaseId, input.actorUserId, input.decision === "clear" ? "release" : "uphold", input.reason);
    const [updated] = await tx.update(duplicateIdentityCases).set({ state, reviewedByUserId: input.actorUserId, reviewedAt: new Date(), reviewReason: input.reason, updatedAt: new Date() }).where(eq(duplicateIdentityCases.id, item.id)).returning();
    await recordAssuranceEvent(tx, { caseType: "duplicate_identity", caseId: item.id, actorUserId: input.actorUserId, action: `duplicate_identity.${state}`, fromState: "open", toState: state, payload: { financialReversalAutomatic: false } });
    return updated;
  });
}
