import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  identityCases,
  identityConsents,
  identityEvidenceMetadata,
  identityLifecycleEvents,
  identityReviews,
  reps,
  users,
  vendors,
  type IdentityCase,
} from "@db/schema";
import { getDb } from "../queries/connection";
import {
  IDENTITY_NOTICE_VERSION,
  IDENTITY_POLICY_VERSION,
  IDENTITY_REVIEW_SLA_HOURS,
  IDENTITY_VALIDITY_DAYS,
  identityApprovalValid,
  identityReadiness,
  identityReverificationDue,
  identitySubjectToken,
  identityTriggerCatalog,
  missingIdentityEvidence,
  personCaseTypes,
  requiredEvidence,
  sanitizeIdentityFindings,
  validateIdentityEvidenceMetadata,
} from "./identityPolicy";

export type IdentityDatabase = ReturnType<typeof getDb>;
export type IdentityTransaction = Parameters<Parameters<IdentityDatabase["transaction"]>[0]>[0];
export type IdentityClient = IdentityDatabase | IdentityTransaction;

const sandboxTokenizationKey = "kampusforce-sandbox-identity-tokenization-not-for-production";
const openStates = ["draft", "submitted", "processing", "needs_more_info", "manual_review"] as const;

function tokenizationSecret() {
  return process.env.KF_IDENTITY_TOKENIZATION_SECRET || sandboxTokenizationKey;
}

function caseRef() {
  return `ID-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

function noticeHash(noticeVersion: string) {
  return createHash("sha256").update(`kampusforce:identity-notice:v1:${noticeVersion}`).digest("hex");
}

async function appendIdentityEvent(tx: IdentityClient, identityCase: IdentityCase, eventType: string, payload: Record<string, string | number | boolean | null> = {}) {
  const safePayload = sanitizeIdentityFindings(payload);
  await tx.insert(identityLifecycleEvents).values({
    eventId: randomUUID(),
    caseId: identityCase.id,
    eventType,
    subjectType: identityCase.subjectType,
    subjectToken: identitySubjectToken(identityCase.subjectType, identityCase.subjectId, tokenizationSecret()),
    caseType: identityCase.caseType,
    caseState: identityCase.state,
    providerMode: identityCase.providerMode,
    payload: safePayload,
  });
}

async function syncUserIdentityEligibility(tx: IdentityClient, userId: number) {
  const history = await tx.select().from(identityCases).where(and(
    eq(identityCases.subjectType, "user"),
    eq(identityCases.subjectId, userId),
    inArray(identityCases.caseType, personCaseTypes),
  )).orderBy(desc(identityCases.createdAt));
  const currentApprovals = history.filter((identityCase) => identityApprovalValid(identityCase));
  const payoutApproval = currentApprovals.some((identityCase) => ["representative_kyc", "campus_lead_kyc"].includes(identityCase.caseType));
  const hasOpenCase = history.some((identityCase) => openStates.includes(identityCase.state as typeof openStates[number]));
  const kycState = currentApprovals.length ? "verified" : hasOpenCase ? "pending" : history.some((identityCase) => identityCase.state === "rejected") ? "rejected" : "unverified";
  await tx.update(users).set({ kycState, bankNameMatch: payoutApproval }).where(eq(users.id, userId));
}

async function ensureIdentityCaseWithClient(input: {
  caseType: IdentityCase["caseType"];
  subjectType: IdentityCase["subjectType"];
  subjectId: number;
  requestedByUserId?: number | null;
  vendorId?: number | null;
  campusId?: number | null;
  triggerEvent: string;
  providerMode?: IdentityCase["providerMode"];
  forceNew?: boolean;
}, client: IdentityClient) {
  if (input.caseType === "customer_handoff") throw new TRPCError({ code: "BAD_REQUEST", message: "Customer KYC remains in the vendor-regulated flow" });
  if (input.subjectType === "user") {
    const [subject] = await client.select({ id: users.id }).from(users).where(eq(users.id, input.subjectId)).limit(1).for("update");
    if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: "Identity subject not found" });
  } else {
    const [subject] = await client.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, input.subjectId)).limit(1).for("update");
    if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: "Identity subject not found" });
  }
  const [existing] = await client.select().from(identityCases).where(and(
    eq(identityCases.caseType, input.caseType),
    eq(identityCases.subjectType, input.subjectType),
    eq(identityCases.subjectId, input.subjectId),
  )).orderBy(desc(identityCases.createdAt)).limit(1);
  if (!input.forceNew && existing && (openStates.includes(existing.state as typeof openStates[number]) || identityApprovalValid(existing))) {
    return { identityCase: existing, created: false };
  }
  const [identityCase] = await client.insert(identityCases).values({
    caseRef: caseRef(),
    caseType: input.caseType,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    requestedByUserId: input.requestedByUserId || null,
    vendorId: input.vendorId || null,
    campusId: input.campusId || null,
    providerMode: input.providerMode || "sandbox",
    policyVersion: IDENTITY_POLICY_VERSION,
    triggerEvent: input.triggerEvent,
    reviewDueAt: new Date(Date.now() + IDENTITY_REVIEW_SLA_HOURS * 3_600_000),
  }).returning();
  await appendIdentityEvent(client, identityCase, "identity.case_opened", { provider_outcome: "case_opened" });
  await client.insert(auditLogs).values({
    actorUserId: input.requestedByUserId || null,
    action: "identity.case_opened",
    entityType: "identity_case",
    entityId: String(identityCase.id),
    metadataJson: { caseRef: identityCase.caseRef, caseType: identityCase.caseType, triggerEvent: input.triggerEvent, rawIdentityDataStored: false },
  });
  return { identityCase, created: true };
}

export async function ensureIdentityCase(input: Parameters<typeof ensureIdentityCaseWithClient>[0], client?: IdentityClient) {
  if (client) return ensureIdentityCaseWithClient(input, client);
  return getDb().transaction((tx) => ensureIdentityCaseWithClient(input, tx));
}

export async function recordIdentityConsent(input: {
  caseId: number;
  actorUserId: number;
  purpose?: string;
  noticeVersion?: string;
  channel?: string;
}) {
  return getDb().transaction(async (tx) => {
    const [identityCase] = await tx.select().from(identityCases).where(eq(identityCases.id, input.caseId)).limit(1).for("update");
    const ownsCase = identityCase && (identityCase.subjectType === "user" ? identityCase.subjectId === input.actorUserId : identityCase.requestedByUserId === input.actorUserId);
    if (!identityCase || !ownsCase) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Identity case not found" });
    }
    if (!openStates.includes(identityCase.state as typeof openStates[number])) throw new TRPCError({ code: "CONFLICT", message: "This case no longer accepts consent changes" });
    const noticeVersion = input.noticeVersion || IDENTITY_NOTICE_VERSION;
    if (noticeVersion !== IDENTITY_NOTICE_VERSION) throw new TRPCError({ code: "BAD_REQUEST", message: "The current privacy notice must be acknowledged" });
    const purpose = input.purpose || "identity_verification";
    if (!["identity_verification", "biometric_liveness"].includes(purpose)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported identity-processing purpose" });
    const [existing] = await tx.select().from(identityConsents).where(and(
      eq(identityConsents.caseId, identityCase.id), eq(identityConsents.purpose, purpose), isNull(identityConsents.withdrawnAt),
    )).limit(1);
    if (existing) return { consentId: existing.id, recorded: false };
    const [consent] = await tx.insert(identityConsents).values({
      caseId: identityCase.id,
      subjectUserId: input.actorUserId,
      purpose,
      noticeVersion,
      channel: input.channel || "web",
      noticeHash: noticeHash(noticeVersion),
    }).returning();
    await appendIdentityEvent(tx, identityCase, "identity.consent_recorded", { review_code: purpose });
    return { consentId: consent.id, recorded: true };
  });
}

export async function submitIdentityCase(caseId: number, actorUserId: number) {
  return getDb().transaction(async (tx) => {
    const [identityCase] = await tx.select().from(identityCases).where(eq(identityCases.id, caseId)).limit(1).for("update");
    const ownsCase = identityCase && (identityCase.subjectType === "user" ? identityCase.subjectId === actorUserId : identityCase.requestedByUserId === actorUserId);
    if (!identityCase || !ownsCase) throw new TRPCError({ code: "NOT_FOUND", message: "Identity case not found" });
    if (!["draft", "needs_more_info"].includes(identityCase.state)) throw new TRPCError({ code: "CONFLICT", message: "Only a draft or information-requested case can be submitted" });
    const consents = await tx.select().from(identityConsents).where(and(eq(identityConsents.caseId, caseId), isNull(identityConsents.withdrawnAt)));
    const purposes = new Set(consents.map((consent) => consent.purpose));
    if (!purposes.has("identity_verification") || !purposes.has("biometric_liveness")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Identity and liveness privacy notices must both be acknowledged" });
    }
    const [updated] = await tx.update(identityCases).set({ state: "submitted", submittedAt: new Date(), updatedAt: new Date(), decisionReason: null }).where(eq(identityCases.id, caseId)).returning();
    if (updated.subjectType === "user") await syncUserIdentityEligibility(tx, actorUserId);
    await appendIdentityEvent(tx, updated, "identity.onboarding_submitted", { provider_outcome: "submitted" });
    await tx.insert(auditLogs).values({ actorUserId, action: "identity.onboarding_submitted", entityType: "identity_case", entityId: String(caseId), metadataJson: { caseRef: updated.caseRef, policyVersion: updated.policyVersion } });
    return updated;
  });
}

export async function recordIdentityEvidence(input: {
  caseId: number;
  actorUserId: number | null;
  kind: "document_ocr" | "document_structure" | "vlm_extraction" | "registry_kyb" | "bank_name_match" | "liveness" | "deepfake" | "face_match" | "capture_integrity" | "reviewer_attestation";
  provider: string;
  state: "recorded" | "passed" | "failed" | "review_required" | "invalidated";
  score?: number | null;
  threshold?: number | null;
  providerReferenceHash?: string | null;
  inputSha256?: string | null;
  modelVersion?: string | null;
  qualityFlags?: string[];
  findings?: Record<string, unknown>;
  capturedAt?: Date | null;
}) {
  if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(input.provider)) throw new TRPCError({ code: "BAD_REQUEST", message: "A bounded provider identifier is required" });
  validateIdentityEvidenceMetadata(input);
  const findings = sanitizeIdentityFindings(input.findings || {});
  return getDb().transaction(async (tx) => {
    const [identityCase] = await tx.select().from(identityCases).where(eq(identityCases.id, input.caseId)).limit(1).for("update");
    if (!identityCase || !["submitted", "processing", "needs_more_info", "manual_review"].includes(identityCase.state)) {
      throw new TRPCError({ code: "CONFLICT", message: "Evidence can be added only to an open submitted case" });
    }
    if (!requiredEvidence(identityCase.caseType).includes(input.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "This evidence kind is not required by the case policy" });
    if (identityCase.providerMode === "live" && !identityReadiness().liveEligible) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Live evidence ingestion is disabled until all external identity readiness gates pass" });
    const [evidence] = await tx.insert(identityEvidenceMetadata).values({
      caseId: input.caseId,
      kind: input.kind,
      provider: input.provider,
      providerReferenceHash: input.providerReferenceHash || null,
      inputSha256: input.inputSha256 || null,
      modelVersion: input.modelVersion || null,
      state: input.state,
      score: input.score === undefined || input.score === null ? null : String(input.score),
      threshold: input.threshold === undefined || input.threshold === null ? null : String(input.threshold),
      qualityFlags: input.qualityFlags || [],
      findings,
      capturedAt: input.capturedAt || null,
    }).returning();
    const [updated] = await tx.update(identityCases).set({ state: "processing", updatedAt: new Date() }).where(eq(identityCases.id, identityCase.id)).returning();
    await appendIdentityEvent(tx, updated, "identity.evidence_recorded", { review_code: input.kind, provider_outcome: input.state });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "identity.evidence_recorded",
      entityType: "identity_case",
      entityId: String(identityCase.id),
      metadataJson: { evidenceId: evidence.id, kind: input.kind, state: input.state, provider: input.provider, rawPayloadPersisted: false },
    });
    return evidence;
  });
}

export async function routeIdentityCaseToReview(caseId: number, actorUserId: number | null) {
  return getDb().transaction(async (tx) => {
    const [identityCase] = await tx.select().from(identityCases).where(eq(identityCases.id, caseId)).limit(1).for("update");
    if (!identityCase || !["submitted", "processing"].includes(identityCase.state)) throw new TRPCError({ code: "CONFLICT", message: "Case is not ready for evidence completion" });
    const evidence = await tx.select().from(identityEvidenceMetadata).where(eq(identityEvidenceMetadata.caseId, caseId)).orderBy(identityEvidenceMetadata.id);
    const missing = missingIdentityEvidence(identityCase.caseType, evidence);
    if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Required passing evidence is missing: ${missing.join(", ")}` });
    const [updated] = await tx.update(identityCases).set({ state: "manual_review", updatedAt: new Date() }).where(eq(identityCases.id, caseId)).returning();
    await appendIdentityEvent(tx, updated, "identity.manual_review_requested", { provider_outcome: "manual_review" });
    await tx.insert(auditLogs).values({ actorUserId, action: "identity.manual_review_requested", entityType: "identity_case", entityId: String(caseId), metadataJson: { evidenceCount: evidence.length } });
    return updated;
  });
}

export async function reviewIdentityCase(input: {
  caseId: number;
  actorUserId: number;
  decision: "approve" | "request_info" | "reject" | "revoke";
  reason: string;
}) {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) throw new TRPCError({ code: "BAD_REQUEST", message: "A review reason between 10 and 500 characters is required" });
  if (/\d{7,}/.test(reason)) throw new TRPCError({ code: "BAD_REQUEST", message: "Do not place identity numbers or other long identifiers in review reasons" });
  const result = await getDb().transaction(async (tx) => {
    const [identityCase] = await tx.select().from(identityCases).where(eq(identityCases.id, input.caseId)).limit(1).for("update");
    if (!identityCase) throw new TRPCError({ code: "NOT_FOUND", message: "Identity case not found" });
    const [reviewer] = await tx.select().from(users).where(eq(users.id, input.actorUserId)).limit(1);
    if (!reviewer || !["ops", "admin"].includes(reviewer.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations review permission is required" });
    if (identityCase.subjectType === "user" && identityCase.subjectId === input.actorUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent review is required; reviewers cannot decide their own identity case" });
    if (input.decision === "approve" && identityCase.state !== "manual_review") throw new TRPCError({ code: "CONFLICT", message: "Approval requires a complete manual-review queue entry" });
    if (input.decision !== "approve" && !["manual_review", "processing", "submitted", "approved", "needs_more_info"].includes(identityCase.state)) {
      throw new TRPCError({ code: "CONFLICT", message: "This case cannot be changed from its current state" });
    }
    let evidence: (typeof identityEvidenceMetadata.$inferSelect)[] = [];
    if (input.decision === "approve") {
      evidence = await tx.select().from(identityEvidenceMetadata).where(eq(identityEvidenceMetadata.caseId, identityCase.id)).orderBy(identityEvidenceMetadata.id);
      const missing = missingIdentityEvidence(identityCase.caseType, evidence);
      if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Approval is blocked until all required evidence passes: ${missing.join(", ")}` });
      if (identityCase.providerMode === "live" && !identityReadiness().liveEligible) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Live identity approval is blocked until all provider, evaluation, privacy, legal and security gates pass" });
    }
    const nextState = input.decision === "approve" ? "approved" : input.decision === "request_info" ? "needs_more_info" : input.decision === "reject" ? "rejected" : "revoked";
    const decidedAt = new Date();
    const validUntil = nextState === "approved" ? new Date(decidedAt.getTime() + IDENTITY_VALIDITY_DAYS * 86_400_000) : null;
    const [updated] = await tx.update(identityCases).set({
      state: nextState,
      decidedAt,
      decidedByUserId: input.actorUserId,
      decisionReason: reason,
      validUntil,
      updatedAt: decidedAt,
    }).where(eq(identityCases.id, identityCase.id)).returning();
    await tx.insert(identityReviews).values({ caseId: identityCase.id, actorUserId: input.actorUserId, decision: input.decision, reason, previousState: identityCase.state, resultingState: nextState });
    if (identityCase.subjectType === "user") await syncUserIdentityEligibility(tx, identityCase.subjectId);
    if (identityCase.subjectType === "vendor") {
      const status = nextState === "approved" ? "active" : nextState === "revoked" ? "paused" : "pending";
      await tx.update(vendors).set({ status }).where(eq(vendors.id, identityCase.subjectId));
    }
    await appendIdentityEvent(tx, updated, `identity.${nextState}`, { provider_outcome: nextState });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: `identity.${input.decision}`,
      entityType: "identity_case",
      entityId: String(identityCase.id),
      metadataJson: { previousState: identityCase.state, resultingState: nextState, validUntil, independentReview: true, liveProviderApprovalImplied: false },
    });
    return { identityCase: updated, evidenceCount: evidence.length };
  });
  return result;
}

export async function currentIdentityApproval(input: {
  subjectType: "user" | "vendor";
  subjectId: number;
  caseTypes: IdentityCase["caseType"][];
}, client: IdentityClient = getDb(), now = new Date()) {
  const cases = await client.select().from(identityCases).where(and(
    eq(identityCases.subjectType, input.subjectType),
    eq(identityCases.subjectId, input.subjectId),
    inArray(identityCases.caseType, input.caseTypes),
    eq(identityCases.state, "approved"),
  )).orderBy(desc(identityCases.decidedAt));
  return cases.find((identityCase) => identityApprovalValid(identityCase, now)) || null;
}

export async function assertCurrentIdentityApproval(input: {
  subjectType: "user" | "vendor";
  subjectId: number;
  caseTypes: IdentityCase["caseType"][];
}, client: IdentityClient = getDb()) {
  const approval = await currentIdentityApproval(input, client);
  if (!approval) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A current approved identity case is required; complete onboarding or reverification first" });
  return approval;
}

export async function payoutIdentityPreflight(userId: number, client: IdentityClient = getDb()) {
  const approval = await currentIdentityApproval({ subjectType: "user", subjectId: userId, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, client);
  return { eligible: !!approval, caseRef: approval?.caseRef || null, validUntil: approval?.validUntil || null, reverificationDue: identityReverificationDue(approval) };
}

export async function getIdentityWorkspace(actor: typeof users.$inferSelect) {
  const db = getDb();
  const privileged = ["ops", "admin"].includes(actor.role);
  let cases: IdentityCase[];
  if (privileged) {
    cases = await db.select().from(identityCases).orderBy(desc(identityCases.createdAt)).limit(100);
  } else if (actor.role === "vendor") {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.userId, actor.id)).limit(1);
    cases = vendor ? await db.select().from(identityCases).where(and(eq(identityCases.subjectType, "vendor"), eq(identityCases.subjectId, vendor.id))).orderBy(desc(identityCases.createdAt)).limit(30) : [];
  } else {
    cases = await db.select().from(identityCases).where(and(eq(identityCases.subjectType, "user"), eq(identityCases.subjectId, actor.id))).orderBy(desc(identityCases.createdAt)).limit(30);
  }
  const caseIds = cases.map((item) => item.id);
  const evidence = caseIds.length ? await db.select().from(identityEvidenceMetadata).where(inArray(identityEvidenceMetadata.caseId, caseIds)).orderBy(identityEvidenceMetadata.id) : [];
  const reviews = privileged && caseIds.length ? await db.select().from(identityReviews).where(inArray(identityReviews.caseId, caseIds)).orderBy(desc(identityReviews.createdAt)).limit(200) : [];
  const consents = caseIds.length ? await db.select({ id: identityConsents.id, caseId: identityConsents.caseId, purpose: identityConsents.purpose, noticeVersion: identityConsents.noticeVersion, capturedAt: identityConsents.capturedAt, withdrawnAt: identityConsents.withdrawnAt }).from(identityConsents).where(inArray(identityConsents.caseId, caseIds)) : [];
  return {
    cases: cases.map((identityCase) => ({
      ...identityCase,
      requiredEvidence: requiredEvidence(identityCase.caseType),
      missingEvidence: missingIdentityEvidence(identityCase.caseType, evidence.filter((item) => item.caseId === identityCase.id)),
      approvalValid: identityApprovalValid(identityCase),
      reverificationDue: identityReverificationDue(identityCase),
    })),
    evidence,
    reviews,
    consents,
    triggers: identityTriggerCatalog,
    readiness: identityReadiness(),
    boundaries: {
      customerKyc: "Vendor-regulated flow; no platform biometric or identity-document decision",
      rawDataStored: false,
      automaticApproval: false,
      liveProviderVerified: false,
      liveExecutionConfigured: identityReadiness().liveEligible,
    },
  };
}

export async function listIdentityLifecycleEvents(limit = 200) {
  const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
  return getDb().select({
    eventId: identityLifecycleEvents.eventId,
    eventType: identityLifecycleEvents.eventType,
    subjectType: identityLifecycleEvents.subjectType,
    subjectToken: identityLifecycleEvents.subjectToken,
    caseType: identityLifecycleEvents.caseType,
    caseState: identityLifecycleEvents.caseState,
    providerMode: identityLifecycleEvents.providerMode,
    payload: identityLifecycleEvents.payload,
    exportState: identityLifecycleEvents.exportState,
    occurredAt: identityLifecycleEvents.occurredAt,
  }).from(identityLifecycleEvents).orderBy(identityLifecycleEvents.id).limit(bounded);
}

export async function expireIdentityApprovals(now = new Date()) {
  return getDb().transaction(async (tx) => {
    const expiring = await tx.select().from(identityCases).where(and(eq(identityCases.state, "approved"), lte(identityCases.validUntil, now))).limit(100).for("update");
    for (const identityCase of expiring) {
      const [updated] = await tx.update(identityCases).set({ state: "expired", updatedAt: now }).where(eq(identityCases.id, identityCase.id)).returning();
      if (identityCase.subjectType === "user") await syncUserIdentityEligibility(tx, identityCase.subjectId);
      if (identityCase.subjectType === "vendor") await tx.update(vendors).set({ status: "paused" }).where(eq(vendors.id, identityCase.subjectId));
      await appendIdentityEvent(tx, updated, "identity.expired", { provider_outcome: "expired" });
      await tx.insert(auditLogs).values({ actorUserId: null, action: "identity.expired", entityType: "identity_case", entityId: String(identityCase.id), metadataJson: { validUntil: identityCase.validUntil } });
    }
    return { expired: expiring.length };
  });
}

export async function withdrawIdentityConsent(caseId: number, actorUserId: number) {
  return getDb().transaction(async (tx) => {
    const [identityCase] = await tx.select().from(identityCases).where(eq(identityCases.id, caseId)).limit(1).for("update");
    const ownsCase = identityCase && (identityCase.subjectType === "user" ? identityCase.subjectId === actorUserId : identityCase.requestedByUserId === actorUserId);
    if (!identityCase || !ownsCase) throw new TRPCError({ code: "NOT_FOUND", message: "Identity case not found" });
    if (["rejected", "expired", "revoked"].includes(identityCase.state)) throw new TRPCError({ code: "CONFLICT", message: "This identity case is already closed" });
    const now = new Date();
    const withdrawn = await tx.update(identityConsents).set({ withdrawnAt: now }).where(and(eq(identityConsents.caseId, caseId), isNull(identityConsents.withdrawnAt))).returning({ id: identityConsents.id });
    if (!withdrawn.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No active consent is recorded for this case" });
    const [updated] = await tx.update(identityCases).set({ state: "revoked", decidedAt: now, decidedByUserId: null, decisionReason: "Consent withdrawn; consent-dependent processing and eligibility stopped", validUntil: null, updatedAt: now }).where(eq(identityCases.id, caseId)).returning();
    if (identityCase.subjectType === "user") await tx.update(users).set({ kycState: "unverified", bankNameMatch: false }).where(eq(users.id, identityCase.subjectId));
    if (identityCase.subjectType === "vendor") await tx.update(vendors).set({ status: "paused" }).where(eq(vendors.id, identityCase.subjectId));
    await appendIdentityEvent(tx, updated, "consent.withdrawn", { provider_outcome: "processing_stopped", review_code: "consent_withdrawn" });
    await tx.insert(auditLogs).values({ actorUserId, action: "identity.consent_withdrawn", entityType: "identity_case", entityId: String(caseId), metadataJson: { previousState: identityCase.state, withdrawnConsents: withdrawn.length, lakehouseTombstoneRequired: true } });
    return { caseRef: updated.caseRef, state: updated.state, withdrawnConsents: withdrawn.length, lakehouseTombstoneRequired: true };
  });
}

export async function requestIdentityReverification(caseId: number, actorUserId: number) {
  return getDb().transaction(async (tx) => {
    const [subject] = await tx.select({ id: users.id }).from(users).where(eq(users.id, actorUserId)).limit(1).for("update");
    if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: "Identity subject not found" });
    const [existing] = await tx.select().from(identityCases).where(eq(identityCases.id, caseId)).limit(1);
    if (!existing || existing.subjectType !== "user" || existing.subjectId !== actorUserId) throw new TRPCError({ code: "NOT_FOUND", message: "Identity case not found" });
    const [open] = await tx.select().from(identityCases).where(and(
      eq(identityCases.caseType, existing.caseType),
      eq(identityCases.subjectType, "user"),
      eq(identityCases.subjectId, actorUserId),
      inArray(identityCases.state, openStates),
    )).orderBy(desc(identityCases.createdAt)).limit(1);
    if (open) return { identityCase: open, created: false };
    if (existing.state === "approved" && !identityReverificationDue(existing)) {
      throw new TRPCError({ code: "CONFLICT", message: "Reverification is not due for this approved identity case" });
    }
    return ensureIdentityCase({
      caseType: existing.caseType,
      subjectType: existing.subjectType,
      subjectId: existing.subjectId,
      requestedByUserId: actorUserId,
      vendorId: existing.vendorId,
      campusId: existing.campusId,
      triggerEvent: "identity.reverification_requested",
      forceNew: true,
    }, tx);
  });
}

export async function subjectForRep(repId: number, client: IdentityClient = getDb()) {
  const [row] = await client.select({ rep: reps, user: users }).from(reps).innerJoin(users, eq(reps.userId, users.id)).where(eq(reps.id, repId)).limit(1);
  return row || null;
}

export async function openIdentityReviewCount() {
  const rows = await getDb().select({ id: identityCases.id }).from(identityCases).where(or(eq(identityCases.state, "submitted"), eq(identityCases.state, "processing"), eq(identityCases.state, "manual_review"), eq(identityCases.state, "needs_more_info")));
  return rows.length;
}
