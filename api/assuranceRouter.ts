import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  activationRiskCases,
  assuranceEvents,
  biometricEvaluations,
  campuses,
  deals,
  duplicateIdentityCases,
  enrollmentAttestations,
  reps,
  users,
  vendorAssuranceAudits,
  vendors,
} from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { getDb } from "./queries/connection";
import {
  expireEnrollmentAttestations,
  registerProviderIdentityLinkage,
  reviewDuplicateIdentityCase,
  reviewEnrollmentAttestation,
  studentAssurancePreflight,
  submitEnrollmentAttestation,
} from "./services/studentAssurance";
import { recordActivationQualitySignal, reviewActivationQualityCase, sweepActivationQuality } from "./services/activationAssurance";
import { recordVendorAssuranceAudit } from "./services/vendorAssurance";
import { expireBiometricEvaluations, recordBiometricEvaluation } from "./services/biometricAssurance";

const reviewReason = z.string().trim().min(10).max(500).refine((value) => !/\d{7,}/.test(value), "Do not paste identity or account identifiers into review notes");
const evidenceReference = z.string().trim().min(8).max(256);
const providerName = z.string().trim().min(2).max(80);

export const assuranceRouter = createRouter({
  overview: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    if (ctx.user.role === "rep") {
      const [rep] = await db.select().from(reps).where(eq(reps.userId, ctx.user.id)).limit(1);
      const enrollments = await db.select({ attestation: enrollmentAttestations, campusName: campuses.name }).from(enrollmentAttestations)
        .innerJoin(campuses, eq(enrollmentAttestations.campusId, campuses.id)).where(eq(enrollmentAttestations.userId, ctx.user.id)).orderBy(desc(enrollmentAttestations.createdAt)).limit(20);
      const preflight = await studentAssurancePreflight(ctx.user.id);
      const risks = rep ? await db.select().from(activationRiskCases).where(eq(activationRiskCases.repId, rep.id)).orderBy(desc(activationRiskCases.createdAt)).limit(30) : [];
      return { scope: "rep" as const, enrollments, preflight, risks, duplicateReviewOpen: preflight.duplicateReviewOpen };
    }
    requireRole(ctx.user, ["ops", "admin", "finance"]);
    const [enrollments, duplicates, risks, vendorAudits, biometrics, events, repOptions, vendorOptions] = await Promise.all([
      db.select({ attestation: enrollmentAttestations, user: users, campusName: campuses.name }).from(enrollmentAttestations)
        .innerJoin(users, eq(enrollmentAttestations.userId, users.id)).innerJoin(campuses, eq(enrollmentAttestations.campusId, campuses.id)).orderBy(desc(enrollmentAttestations.createdAt)).limit(100),
      db.select({ item: duplicateIdentityCases, subjectName: users.name }).from(duplicateIdentityCases).innerJoin(users, eq(duplicateIdentityCases.userId, users.id)).orderBy(desc(duplicateIdentityCases.createdAt)).limit(100),
      db.select({ item: activationRiskCases, repCode: reps.code, subjectName: users.name, vendorName: vendors.companyName, dealState: deals.state }).from(activationRiskCases)
        .innerJoin(reps, eq(activationRiskCases.repId, reps.id)).innerJoin(users, eq(reps.userId, users.id)).innerJoin(vendors, eq(activationRiskCases.vendorId, vendors.id)).innerJoin(deals, eq(activationRiskCases.dealId, deals.id)).orderBy(desc(activationRiskCases.createdAt)).limit(100),
      db.select({ item: vendorAssuranceAudits, vendorName: vendors.companyName, vendorStatus: vendors.status }).from(vendorAssuranceAudits).innerJoin(vendors, eq(vendorAssuranceAudits.vendorId, vendors.id)).orderBy(desc(vendorAssuranceAudits.createdAt)).limit(100),
      db.select().from(biometricEvaluations).orderBy(desc(biometricEvaluations.createdAt)).limit(100),
      db.select().from(assuranceEvents).orderBy(desc(assuranceEvents.createdAt)).limit(200),
      db.select({ rep: reps, user: users, campusName: campuses.name }).from(reps).innerJoin(users, eq(reps.userId, users.id)).innerJoin(campuses, eq(reps.campusId, campuses.id)).orderBy(users.name),
      db.select().from(vendors).orderBy(vendors.companyName),
    ]);
    return {
      scope: "operations" as const,
      enrollments, duplicates, risks, vendorAudits, biometrics, events, repOptions, vendorOptions,
      metrics: {
        pendingEnrollment: enrollments.filter((row) => row.attestation.state === "submitted").length,
        duplicateOpen: duplicates.filter((row) => row.item.state === "open").length,
        activationOpen: risks.filter((row) => row.item.state === "open").length,
        payoutDelaySignals: risks.filter((row) => row.item.state === "open" && !!row.item.fraudCaseId).length,
        failedVendors: vendorAudits.filter((row) => row.item.state === "failed").length,
        currentBiometricEvaluations: biometrics.filter((item) => item.state === "approved" && item.validUntil > new Date()).length,
      },
    };
  }),

  submitEnrollment: authedQuery.input(z.object({
    providerName,
    providerMode: z.enum(["sandbox", "live"]),
    attestationReference: evidenceReference,
    academicTerm: z.string().trim().min(2).max(40),
    verificationMethod: z.enum(["institution_provider", "institution_document", "student_record_provider"]),
    requestedValidUntil: z.date(),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    return submitEnrollmentAttestation({ ...input, userId: ctx.user.id });
  }),

  reviewEnrollment: authedQuery.input(z.object({ caseId: z.number().int().positive(), decision: z.enum(["verify", "reject", "revoke"]), reason: reviewReason })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return reviewEnrollmentAttestation({ ...input, actorUserId: ctx.user.id });
  }),

  expireEnrollments: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return expireEnrollmentAttestations();
  }),

  registerLinkage: authedQuery.input(z.object({ userId: z.number().int().positive(), providerName, providerMode: z.enum(["sandbox", "live"]), providerSubjectToken: evidenceReference })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return registerProviderIdentityLinkage({ ...input, actorUserId: ctx.user.id });
  }),

  reviewDuplicate: authedQuery.input(z.object({ caseId: z.number().int().positive(), decision: z.enum(["clear", "confirm"]), reason: reviewReason })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return reviewDuplicateIdentityCase({ ...input, actorUserId: ctx.user.id });
  }),

  recordActivationSignal: authedQuery.input(z.object({
    dealId: z.number().int().positive(), kind: z.enum(["early_refund", "repeated_customer", "dormant_account", "chargeback", "coordinated_cluster"]),
    severity: z.enum(["warning", "high", "critical"]), evidenceReference, signalCount: z.number().int().min(1).max(100000).default(1),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recordActivationQualitySignal({ ...input, actorUserId: ctx.user.id });
  }),

  sweepActivationQuality: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return sweepActivationQuality(ctx.user.id);
  }),

  reviewActivation: authedQuery.input(z.object({ caseId: z.number().int().positive(), decision: z.enum(["clear", "confirm"]), reason: reviewReason })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return reviewActivationQualityCase({ ...input, actorUserId: ctx.user.id });
  }),

  recordVendorAudit: authedQuery.input(z.object({
    vendorId: z.number().int().positive(), periodStart: z.date(), periodEnd: z.date(), sampleSize: z.number().int().min(1).max(100000),
    verifiedOutcomes: z.number().int().nonnegative().max(100000), mismatches: z.number().int().nonnegative().max(100000), evidenceReference, reviewReason,
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recordVendorAssuranceAudit({ ...input, actorUserId: ctx.user.id });
  }),

  recordBiometricEvaluation: authedQuery.input(z.object({
    providerName, providerMode: z.enum(["sandbox", "live"]), kind: z.enum(["pad", "injection", "deepfake", "demographic"]),
    modelVersion: z.string().trim().min(2).max(100), evidenceReference, decision: z.enum(["approved", "rejected"]), validUntil: z.date(), reviewReason,
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return recordBiometricEvaluation({ ...input, actorUserId: ctx.user.id });
  }),

  expireBiometricEvaluations: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    return expireBiometricEvaluations();
  }),
});
