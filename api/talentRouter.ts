import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import { talentCampaignTypes } from "./services/talentAccess";
import {
  activateTalentCampaign,
  applyToTalentCampaign,
  bulkApplyToTalentCampaign,
  createTalentCampaign,
  enforceTalentRetention,
  exportTalentCampaign,
  listExpiredTalentApplicants,
  listTalentWorkspace,
  reviewTalentCampaign,
  setTalentCampaignState,
  submitTalentCampaign,
  withdrawTalentConsent,
} from "./services/talentCampaigns";
import {
  advanceTalentApplication,
  createTalentAssessment,
  createTalentOffer,
  deleteTalentDocument,
  issueTalentOffer,
  respondToTalentOffer,
  reviewTalentAssessment,
  scheduleTalentInterview,
  scoreTalentInterview,
  submitTalentAssessment,
  talentDocumentUrl,
  uploadTalentDocument,
  verifyTalentOutcome,
} from "./services/talentApplications";

const id = z.number().int().positive();
const text = (max = 200) => z.string().trim().min(2).max(max);
const profile = z.object({
  campusId: id,
  fullName: text(180),
  email: z.string().trim().email().max(320),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  course: text(160),
  studyLevel: text(60),
  graduationYear: z.number().int().min(2000).max(2100),
  consentVersion: text(60),
  consentedAt: z.coerce.date(),
  retentionUntil: z.coerce.date(),
});
const actor = async (ctx: { user: Parameters<typeof salesActorForUser>[0] }) => salesActorForUser(ctx.user);

export const talentRouter = createRouter({
  workspace: authedQuery.query(async ({ ctx }) => listTalentWorkspace(await actor(ctx))),
  createCampaign: authedQuery.input(z.object({ vendorId: id.optional(), title: text(), campaignType: z.enum(talentCampaignTypes), summary: text(4000), targetCount: z.number().int().min(1).max(100000), eligibleCourses: z.array(text(160)).max(30), startsAt: z.coerce.date(), endsAt: z.coerce.date(), targets: z.array(z.object({ campusId: id, targetCount: z.number().int().min(1).max(100000) })).min(1).max(100) })).mutation(async ({ ctx, input }) => createTalentCampaign({ ...input, actor: await actor(ctx) })),
  submitCampaign: authedQuery.input(z.object({ campaignId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => submitTalentCampaign({ ...input, actor: await actor(ctx) })),
  reviewCampaign: authedQuery.input(z.object({ campaignId: id, decision: z.enum(["approved", "rejected"]), note: text(1000) })).mutation(async ({ ctx, input }) => reviewTalentCampaign({ ...input, actor: await actor(ctx) })),
  activateCampaign: authedQuery.input(z.object({ campaignId: id })).mutation(async ({ ctx, input }) => activateTalentCampaign({ ...input, actor: await actor(ctx) })),
  setCampaignState: authedQuery.input(z.object({ campaignId: id, state: z.enum(["paused", "closed"]) })).mutation(async ({ ctx, input }) => setTalentCampaignState({ ...input, actor: await actor(ctx) })),
  submitApplication: authedQuery.input(z.object({ campaignId: id, applicantId: id.optional(), profile: profile.optional() })).mutation(async ({ ctx, input }) => applyToTalentCampaign({ ...input, actor: await actor(ctx) })),
  bulkApply: authedQuery.input(z.object({ campaignId: id, importRef: z.string().regex(/^KF-IMPORT-[A-Za-z0-9-]{4,80}$/), rows: z.array(profile).min(1).max(1000) })).mutation(async ({ ctx, input }) => bulkApplyToTalentCampaign({ ...input, actor: await actor(ctx) })),
  exportCampaign: authedQuery.input(z.object({ campaignId: id, destination: z.enum(["generic_ats", "hris", "report"]) })).mutation(async ({ ctx, input }) => exportTalentCampaign({ ...input, actor: await actor(ctx) })),
  withdrawConsent: authedQuery.input(z.object({ applicantId: id })).mutation(async ({ ctx, input }) => withdrawTalentConsent({ ...input, actor: await actor(ctx) })),
  expiredApplicants: authedQuery.query(async ({ ctx }) => listExpiredTalentApplicants({ actor: await actor(ctx) })),
  enforceRetention: authedQuery.input(z.object({ applicantId: id })).mutation(async ({ ctx, input }) => enforceTalentRetention({ ...input, actor: await actor(ctx) })),
  advanceApplication: authedQuery.input(z.object({ applicationId: id, expectedVersion: z.number().int().positive(), toStage: z.enum(["screening", "offer", "accepted", "rejected"]), reason: text(1000) })).mutation(async ({ ctx, input }) => advanceTalentApplication({ ...input, actor: await actor(ctx) })),
  uploadDocument: authedQuery.input(z.object({ applicationId: id, documentType: z.enum(["cv", "transcript", "course_document", "certificate", "other"]), fileName: z.string().min(1).max(255), contentBase64: z.string().max(140 * 1024 * 1024), contentType: z.string().max(160) })).mutation(async ({ ctx, input }) => uploadTalentDocument({ ...input, actor: await actor(ctx) })),
  documentUrl: authedQuery.input(z.object({ documentId: id })).query(async ({ ctx, input }) => talentDocumentUrl({ ...input, actor: await actor(ctx) })),
  deleteDocument: authedQuery.input(z.object({ documentId: id })).mutation(async ({ ctx, input }) => deleteTalentDocument({ ...input, actor: await actor(ctx) })),
  createAssessment: authedQuery.input(z.object({ applicationId: id, kind: z.enum(["geology", "mathematics", "aptitude", "custom"]), title: text(), questions: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), prompt: text(1000), maxScore: z.number().int().min(1).max(100) })).min(1).max(30) })).mutation(async ({ ctx, input }) => createTalentAssessment({ ...input, actor: await actor(ctx) })),
  submitAssessment: authedQuery.input(z.object({ assessmentId: id, responses: z.record(z.string(), z.string().trim().min(1).max(4000)) })).mutation(async ({ ctx, input }) => submitTalentAssessment({ ...input, actor: await actor(ctx) })),
  reviewAssessment: authedQuery.input(z.object({ assessmentId: id, score: z.number().int().min(0).max(3000), rubricNote: text(2000) })).mutation(async ({ ctx, input }) => reviewTalentAssessment({ ...input, actor: await actor(ctx) })),
  scheduleInterview: authedQuery.input(z.object({ applicationId: id, scheduledAt: z.coerce.date(), durationMinutes: z.number().int().min(15).max(240), mode: z.enum(["virtual", "in_person", "phone"]), location: text(500), interviewerUserId: id })).mutation(async ({ ctx, input }) => scheduleTalentInterview({ ...input, actor: await actor(ctx) })),
  scoreInterview: authedQuery.input(z.object({ interviewId: id, scorecard: z.object({ technical: z.number().int().min(0).max(100), communication: z.number().int().min(0).max(100), teamwork: z.number().int().min(0).max(100) }), recommendation: z.enum(["strong_yes", "yes", "no", "strong_no"]), notes: text(2000) })).mutation(async ({ ctx, input }) => scoreTalentInterview({ ...input, actor: await actor(ctx) })),
  createOffer: authedQuery.input(z.object({ applicationId: id, title: text(), termsSummary: text(4000), expiresAt: z.coerce.date() })).mutation(async ({ ctx, input }) => createTalentOffer({ ...input, actor: await actor(ctx) })),
  issueOffer: authedQuery.input(z.object({ offerId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => issueTalentOffer({ ...input, actor: await actor(ctx) })),
  respondOffer: publicQuery.input(z.object({ acceptanceToken: z.string().min(32).max(200), decision: z.enum(["accepted", "declined"]) })).mutation(async ({ input }) => respondToTalentOffer(input)),
  verifyOutcome: authedQuery.input(z.object({ applicationId: id, observedByUserId: id, evidenceNote: text(2000), observedAt: z.coerce.date() })).mutation(async ({ ctx, input }) => verifyTalentOutcome({ ...input, actor: await actor(ctx) })),
});
