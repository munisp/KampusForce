import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { auditLogs, identityCases, reps, users, vendors } from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { getDb } from "./queries/connection";
import {
  ensureIdentityCase,
  getIdentityWorkspace,
  listIdentityLifecycleEvents,
  recordIdentityConsent,
  recordIdentityEvidence,
  requestIdentityReverification,
  reviewIdentityCase,
  routeIdentityCaseToReview,
  submitIdentityCase,
  withdrawIdentityConsent,
} from "./services/identity";
import { processSyntheticIdentityCase } from "./services/identityFixtures";
import { purgeCaseDocuments, uploadCaseDocument, viewIdentityDocument } from "./services/identityDocuments";
import { notifyUser } from "./services/notifications";
import { GOVERNMENT_ID_TYPES } from "./services/identityDocuments";

const evidenceKind = z.enum(["document_ocr", "document_structure", "vlm_extraction", "registry_kyb", "bank_name_match", "liveness", "deepfake", "face_match", "capture_integrity", "reviewer_attestation"]);

async function openScopedCase(actor: typeof users.$inferSelect, caseType: "representative_kyc" | "campus_lead_kyc" | "vendor_kyb" | "operations_kyc") {
  if (caseType === "vendor_kyb") {
    requireRole(actor, ["vendor"]);
    const [vendor] = await getDb().select().from(vendors).where(eq(vendors.userId, actor.id)).limit(1);
    if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor profile not found" });
    return ensureIdentityCase({ caseType, subjectType: "vendor", subjectId: vendor.id, requestedByUserId: actor.id, vendorId: vendor.id, triggerEvent: "vendor.activation_requested" });
  }
  if (caseType === "operations_kyc") {
    requireRole(actor, ["ops", "admin", "finance"]);
    return ensureIdentityCase({ caseType, subjectType: "user", subjectId: actor.id, requestedByUserId: actor.id, triggerEvent: "operations.access_requested" });
  }
  requireRole(actor, ["rep"]);
  const [rep] = await getDb().select().from(reps).where(eq(reps.userId, actor.id)).limit(1);
  return ensureIdentityCase({
    caseType,
    subjectType: "user",
    subjectId: actor.id,
    requestedByUserId: actor.id,
    campusId: rep?.campusId || null,
    triggerEvent: caseType === "campus_lead_kyc" ? "campus_lead.promotion_requested" : "representative.onboarding_submitted",
  });
}

export const identityRouter = createRouter({
  overview: authedQuery.query(async ({ ctx }) => getIdentityWorkspace(ctx.user)),

  openCase: authedQuery.input(z.object({
    caseType: z.enum(["representative_kyc", "campus_lead_kyc", "vendor_kyb", "operations_kyc"]),
  })).mutation(async ({ ctx, input }) => openScopedCase(ctx.user, input.caseType)),

  consent: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    purpose: z.enum(["identity_verification", "biometric_liveness"]),
    noticeAcknowledged: z.literal(true),
  })).mutation(async ({ ctx, input }) => recordIdentityConsent({ caseId: input.caseId, actorUserId: ctx.user.id, purpose: input.purpose })),

  submit: authedQuery.input(z.object({ caseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const submitted = await submitIdentityCase(input.caseId, ctx.user.id);
    if (submitted.state === "manual_review") {
      const reviewers = await getDb().select({ id: users.id }).from(users).where(inArray(users.role, ["ops", "admin"]));
      for (const reviewer of reviewers) await notifyUser({ userId: reviewer.id, type: "identity_review_needed", title: "A check needs your review", body: `${submitted.caseRef} is waiting for a decision.`, href: "/identity", entityType: "identity_case", entityId: submitted.id });
    }
    return submitted;
  }),

  uploadDocument: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    kind: z.enum(["government_id", "selfie", "business_certificate", "owner_id"]),
    idType: z.enum(GOVERNMENT_ID_TYPES).optional(),
    contentBase64: z.string().min(4).max(14 * 1024 * 1024),
  })).mutation(async ({ ctx, input }) => {
    if (["government_id", "owner_id"].includes(input.kind) && !input.idType) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose which ID you're uploading." });
    return uploadCaseDocument({ ...input, idType: ["government_id", "owner_id"].includes(input.kind) ? input.idType : undefined, actorUserId: ctx.user.id });
  }),

  viewDocument: authedQuery.input(z.object({ documentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => viewIdentityDocument({ documentId: input.documentId, actor: ctx.user })),

  processSandbox: authedQuery.input(z.object({ caseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return processSyntheticIdentityCase(input.caseId, ctx.user.id);
  }),

  recordEvidence: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    kind: evidenceKind,
    provider: z.string().min(2).max(80),
    state: z.enum(["recorded", "passed", "failed", "review_required", "invalidated"]),
    score: z.number().min(0).max(1).nullable().optional(),
    threshold: z.number().min(0).max(1).nullable().optional(),
    providerReferenceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    modelVersion: z.string().max(100).nullable().optional(),
    qualityFlags: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(12).optional(),
    findings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recordIdentityEvidence({ ...input, actorUserId: ctx.user.id });
  }),

  routeReview: authedQuery.input(z.object({ caseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return routeIdentityCaseToReview(input.caseId, ctx.user.id);
  }),

  review: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    decision: z.enum(["approve", "request_info", "reject", "revoke"]),
    reason: z.string().trim().min(10).max(500),
    confirmedChecks: z.array(z.string().max(40)).max(8).optional(),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const result = await reviewIdentityCase({ ...input, actorUserId: ctx.user.id });
    const decided = result.identityCase;
    const [row] = await getDb().select().from(identityCases).where(eq(identityCases.id, decided.id)).limit(1);
    const applicant = row.subjectType === "user" ? row.subjectId : row.requestedByUserId;
    const message = { approve: ["You're verified", "Your check was approved."], request_info: ["We need more from you", `Operations asked for more information: ${input.reason}`], reject: ["Your check wasn't approved", input.reason], revoke: ["Your approval was withdrawn", input.reason] }[input.decision];
    if (applicant) await notifyUser({ userId: applicant, type: `identity_${input.decision}`, title: message[0], body: message[1], href: "/identity", entityType: "identity_case", entityId: decided.id });
    return result;
  }),

  reverify: authedQuery.input(z.object({ caseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => requestIdentityReverification(input.caseId, ctx.user.id)),

  withdrawConsent: authedQuery.input(z.object({ caseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const withdrawn = await withdrawIdentityConsent(input.caseId, ctx.user.id);
    await purgeCaseDocuments(input.caseId);
    return withdrawn;
  }),

  customerHandoff: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["vendor"]);
    const [vendor] = await getDb().select().from(vendors).where(eq(vendors.userId, ctx.user.id)).limit(1);
    if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor profile not found" });
    await getDb().insert(auditLogs).values({
      actorUserId: ctx.user.id,
      action: "customer.vendor_handoff_requested",
      entityType: "vendor",
      entityId: String(vendor.id),
      metadataJson: { customerKycDecision: "vendor_regulated_flow", rawCustomerIdentityAccepted: false },
    });
    return { status: "vendor_regulated_flow", vendorId: vendor.id, platformKycDecision: false, rawCustomerIdentityAccepted: false };
  }),

  events: authedQuery.input(z.object({ limit: z.number().int().min(1).max(500).default(200) })).query(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return listIdentityLifecycleEvents(input.limit);
  }),
});
