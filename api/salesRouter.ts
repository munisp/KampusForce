import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import {
  addCaseMessage,
  assignCase,
  linkCases,
  listCaseWorkspace,
  reopenCase,
  saveCaseView,
  setCaseWatch,
  snoozeCase,
} from "./services/caseManagement";
import {
  addOpportunityActivity,
  createOpportunity,
  createOpportunityTask,
  generateOutreachDraft,
  listPipeline,
  saveCrmSegment,
  setOpportunityTaskState,
  setOutreachState,
  updateOpportunityStage,
} from "./services/crm";
import { getTrainingWorkspace, startTraining, submitTrainingAttempt } from "./services/training";
import { activateCampaign, createCampaign, listCampaignWorkspace, pauseCampaign, reviewCampaign, submitCampaignReview } from "./services/campaigns";
import { createVendorService, listVendorServices, syncVendorService, testVendorService } from "./services/vendorServices";
import { inviteSuggestedStudent, listGrowthWorkspace, refreshOpportunityTargets, scheduleRecruitmentFollowUp, setRecommendationState, suggestStudent } from "./services/growth";

const id = z.number().int().positive();
const filters = z.record(z.string(), z.unknown());

export const salesRouter = createRouter({
  cases: authedQuery.query(async ({ ctx }) => listCaseWorkspace(await salesActorForUser(ctx.user))),
  assignCase: authedQuery.input(z.object({ ticketId: id, assigneeUserId: id.nullable(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) =>
    assignCase({ ...input, actor: await salesActorForUser(ctx.user) })),
  addCaseMessage: authedQuery.input(z.object({ ticketId: id, visibility: z.enum(["internal", "public"]), body: z.string().trim().min(2).max(4000) })).mutation(async ({ ctx, input }) =>
    addCaseMessage({ ...input, actor: await salesActorForUser(ctx.user) })),
  snoozeCase: authedQuery.input(z.object({ ticketId: id, until: z.coerce.date(), note: z.string().trim().min(3).max(1000) })).mutation(async ({ ctx, input }) =>
    snoozeCase({ ...input, actor: await salesActorForUser(ctx.user) })),
  reopenCase: authedQuery.input(z.object({ ticketId: id, reason: z.string().trim().min(5).max(1000) })).mutation(async ({ ctx, input }) =>
    reopenCase({ ...input, actor: await salesActorForUser(ctx.user) })),
  linkCases: authedQuery.input(z.object({ ticketId: id, relatedTicketId: id, linkType: z.enum(["related", "duplicate", "blocks"]) })).mutation(async ({ ctx, input }) =>
    linkCases({ ...input, actor: await salesActorForUser(ctx.user) })),
  watchCase: authedQuery.input(z.object({ ticketId: id, watching: z.boolean() })).mutation(async ({ ctx, input }) =>
    setCaseWatch({ ...input, actor: await salesActorForUser(ctx.user) })),
  saveCaseView: authedQuery.input(z.object({ name: z.string().trim().min(2).max(100), filters })).mutation(async ({ ctx, input }) =>
    saveCaseView({ ...input, actor: await salesActorForUser(ctx.user) })),

  pipeline: authedQuery.query(async ({ ctx }) => listPipeline(await salesActorForUser(ctx.user))),
  createOpportunity: authedQuery.input(z.object({ repId: id, productId: id, alias: z.string().trim().min(2).max(120), customerPhone: z.string().max(20).optional(), nextActionAt: z.coerce.date().optional() })).mutation(async ({ ctx, input }) =>
    createOpportunity({ ...input, actor: await salesActorForUser(ctx.user) })),
  updateOpportunityStage: authedQuery.input(z.object({ opportunityId: id, stage: z.enum(["targeted", "contacted", "qualified", "activation_pending", "won", "lost"]), expectedVersion: z.number().int().positive(), lostReason: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) =>
    updateOpportunityStage({ ...input, actor: await salesActorForUser(ctx.user) })),
  addOpportunityActivity: authedQuery.input(z.object({ opportunityId: id, activityType: z.enum(["note", "call", "meeting", "message"]), body: z.string().trim().min(2).max(4000), nextActionAt: z.coerce.date().nullable().optional() })).mutation(async ({ ctx, input }) =>
    addOpportunityActivity({ ...input, actor: await salesActorForUser(ctx.user) })),
  createOpportunityTask: authedQuery.input(z.object({ opportunityId: id, title: z.string().trim().min(3).max(200), dueAt: z.coerce.date() })).mutation(async ({ ctx, input }) =>
    createOpportunityTask({ ...input, actor: await salesActorForUser(ctx.user) })),
  setOpportunityTaskState: authedQuery.input(z.object({ taskId: id, state: z.enum(["completed", "dismissed"]) })).mutation(async ({ ctx, input }) =>
    setOpportunityTaskState({ ...input, actor: await salesActorForUser(ctx.user) })),
  generateOutreachDraft: authedQuery.input(z.object({ opportunityId: id })).mutation(async ({ ctx, input }) =>
    generateOutreachDraft({ ...input, actor: await salesActorForUser(ctx.user) })),
  setOutreachState: authedQuery.input(z.object({ draftId: id, action: z.enum(["approve", "mark_shared", "dismiss"]) })).mutation(async ({ ctx, input }) =>
    setOutreachState({ ...input, actor: await salesActorForUser(ctx.user) })),
  saveCrmSegment: authedQuery.input(z.object({ name: z.string().trim().min(2).max(100), filters })).mutation(async ({ ctx, input }) =>
    saveCrmSegment({ ...input, actor: await salesActorForUser(ctx.user) })),

  training: authedQuery.query(async ({ ctx }) => getTrainingWorkspace(await salesActorForUser(ctx.user))),
  startTraining: authedQuery.input(z.object({ moduleId: id })).mutation(async ({ ctx, input }) =>
    startTraining(await salesActorForUser(ctx.user), input.moduleId)),
  submitTrainingAttempt: authedQuery.input(z.object({ moduleId: id, answers: z.array(z.number().int().min(0)).min(1).max(20) })).mutation(async ({ ctx, input }) =>
    submitTrainingAttempt({ ...input, actor: await salesActorForUser(ctx.user) })),

  campaigns: authedQuery.query(async ({ ctx }) => listCampaignWorkspace(await salesActorForUser(ctx.user))),
  createCampaign: authedQuery.input(z.object({
    name: z.string().trim().min(3).max(180),
    goal: z.enum(["activation", "recruitment", "training", "reactivation"]),
    productId: id.optional(),
    campusId: id.optional(),
    messageDraft: z.string().trim().min(10).max(4000),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    audienceRules: z.object({ minQualityScore: z.number().int().min(0).max(100).optional(), requiredTrainingModuleKey: z.string().max(80).optional(), includeCampusLeads: z.boolean().optional() }),
  })).mutation(async ({ ctx, input }) => createCampaign({ ...input, actor: await salesActorForUser(ctx.user) })),
  submitCampaignReview: authedQuery.input(z.object({ campaignId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) =>
    submitCampaignReview({ ...input, actor: await salesActorForUser(ctx.user) })),
  reviewCampaign: authedQuery.input(z.object({ campaignId: id, decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(3).max(1000) })).mutation(async ({ ctx, input }) =>
    reviewCampaign({ ...input, actor: await salesActorForUser(ctx.user) })),
  activateCampaign: authedQuery.input(z.object({ campaignId: id })).mutation(async ({ ctx, input }) =>
    activateCampaign({ ...input, actor: await salesActorForUser(ctx.user) })),
  pauseCampaign: authedQuery.input(z.object({ campaignId: id })).mutation(async ({ ctx, input }) =>
    pauseCampaign({ ...input, actor: await salesActorForUser(ctx.user) })),

  integrations: authedQuery.query(async ({ ctx }) => listVendorServices(await salesActorForUser(ctx.user))),
  createVendorService: authedQuery.input(z.object({ vendorId: id, service: z.enum(["catalog", "crm", "support", "messaging"]), displayName: z.string().trim().min(3).max(160), mode: z.enum(["sandbox", "live"]) })).mutation(async ({ ctx, input }) =>
    createVendorService({ ...input, actor: await salesActorForUser(ctx.user) })),
  testVendorService: authedQuery.input(z.object({ connectionId: id })).mutation(async ({ ctx, input }) =>
    testVendorService({ ...input, actor: await salesActorForUser(ctx.user) })),
  syncVendorService: authedQuery.input(z.object({ connectionId: id })).mutation(async ({ ctx, input }) =>
    syncVendorService({ ...input, actor: await salesActorForUser(ctx.user) })),

  growth: authedQuery.input(z.object({ days: z.number().int().min(7).max(365).default(30) })).query(async ({ ctx, input }) =>
    listGrowthWorkspace(await salesActorForUser(ctx.user), input.days)),
  refreshTargets: authedQuery.input(z.object({ repId: id.optional() })).mutation(async ({ ctx, input }) =>
    refreshOpportunityTargets(await salesActorForUser(ctx.user), input.repId)),
  setRecommendationState: authedQuery.input(z.object({ recommendationId: id, action: z.enum(["accept", "dismiss"]), alias: z.string().trim().min(2).max(120).optional(), customerPhone: z.string().max(20).optional() })).mutation(async ({ ctx, input }) =>
    setRecommendationState({ ...input, actor: await salesActorForUser(ctx.user) })),
  suggestStudent: authedQuery.input(z.object({ candidateName: z.string().trim().min(3).max(160), strengths: z.string().trim().min(5).max(300), note: z.string().trim().max(500).optional(), consentConfirmed: z.literal(true) })).mutation(async ({ ctx, input }) =>
    suggestStudent({ ...input, actor: await salesActorForUser(ctx.user) })),
  inviteSuggestedStudent: authedQuery.input(z.object({ referralId: id, phone: z.string().min(7).max(20) })).mutation(async ({ ctx, input }) =>
    inviteSuggestedStudent({ ...input, actor: await salesActorForUser(ctx.user) })),
  scheduleRecruitmentFollowUp: authedQuery.input(z.object({ recruitmentId: id, nextFollowUpAt: z.coerce.date(), note: z.string().trim().min(3).max(1000) })).mutation(async ({ ctx, input }) =>
    scheduleRecruitmentFollowUp({ ...input, actor: await salesActorForUser(ctx.user) })),
});
