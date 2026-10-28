import { eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { auditLogs, reps, users, vendors } from "@db/schema";
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
  }).strict()).mutation(async ({ ctx, input }) => openScopedCase(ctx.user, input.caseType)),

  consent: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    purpose: z.enum(["identity_verification", "biometric_liveness"]),
    noticeAcknowledged: z.literal(true),
  }).strict()).mutation(async ({ ctx, input }) => recordIdentityConsent({ caseId: input.caseId, actorUserId: ctx.user.id, purpose: input.purpose })),

  submit: authedQuery.input(z.object({ caseId: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => submitIdentityCase(input.caseId, ctx.user.id)),

  processSandbox: authedQuery.input(z.object({ caseId: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => {
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
  }).strict()).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recordIdentityEvidence({ ...input, actorUserId: ctx.user.id });
  }),

  routeReview: authedQuery.input(z.object({ caseId: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return routeIdentityCaseToReview(input.caseId, ctx.user.id);
  }),

  review: authedQuery.input(z.object({
    caseId: z.number().int().positive(),
    decision: z.enum(["approve", "request_info", "reject", "revoke"]),
    reason: z.string().trim().min(10).max(500),
  }).strict()).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return reviewIdentityCase({ ...input, actorUserId: ctx.user.id });
  }),

  reverify: authedQuery.input(z.object({ caseId: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => requestIdentityReverification(input.caseId, ctx.user.id)),

  withdrawConsent: authedQuery.input(z.object({ caseId: z.number().int().positive() }).strict()).mutation(async ({ ctx, input }) => withdrawIdentityConsent(input.caseId, ctx.user.id)),

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

  events: authedQuery.input(z.object({ limit: z.number().int().min(1).max(500).default(200) }).strict()).query(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return listIdentityLifecycleEvents(input.limit);
  }),
});
