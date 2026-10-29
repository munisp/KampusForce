import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import {
  addCrmCollaborationNote,
  addCrmInfluence,
  advanceCrmSequence,
  applyCrmRouting,
  applyCrmScorecard,
  approveCrmSequence,
  createCrmForecast,
  createCrmRoutingRule,
  createCrmScorecard,
  createCrmSequence,
  detectCrmDuplicates,
  generateCrmRecommendation,
  listCrmInnovationWorkspace,
  proposeCrmRouting,
  recordCrmFeedback,
  resolveCrmDuplicate,
  reviewCrmRecommendation,
} from "./services/crmInnovations";

const id = z.number().int().positive();
const text = (max = 160) => z.string().trim().min(2).max(max);
const actor = async (ctx: { user: Parameters<typeof salesActorForUser>[0] }) => salesActorForUser(ctx.user);

export const crmInnovationRouter = createRouter({
  workspace: authedQuery.query(async ({ ctx }) => listCrmInnovationWorkspace(await actor(ctx))),
  recommend: authedQuery.input(z.object({ opportunityId: id })).mutation(async ({ ctx, input }) => generateCrmRecommendation({ ...input, actor: await actor(ctx) })),
  reviewRecommendation: authedQuery.input(z.object({ recommendationId: id, state: z.enum(["accepted", "dismissed", "completed"]), feedback: z.string().trim().min(2).max(500) })).mutation(async ({ ctx, input }) => reviewCrmRecommendation({ ...input, actor: await actor(ctx) })),
  createScorecard: authedQuery.input(z.object({ scorecardKey: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,79}$/), weights: z.record(z.string(), z.number().min(0).max(100)), rationale: z.string().trim().min(5).max(2000) })).mutation(async ({ ctx, input }) => createCrmScorecard({ ...input, actor: await actor(ctx) })),
  applyScorecard: authedQuery.input(z.object({ scorecardId: id, opportunityId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => applyCrmScorecard({ ...input, actor: await actor(ctx) })),
  createForecast: authedQuery.input(z.object({ name: text(), scenario: z.enum(["commit", "best", "pipeline"]) })).mutation(async ({ ctx, input }) => createCrmForecast({ ...input, actor: await actor(ctx) })),
  createSequence: authedQuery.input(z.object({ opportunityId: id, name: text(), purpose: z.literal("relationship_outreach"), subjectToken: z.string().min(8).max(200), steps: z.array(z.object({ channel: z.enum(["in_app", "email", "sms", "whatsapp"]), body: z.string().trim().min(5).max(2000), dueAt: z.coerce.date() })).min(1).max(5) })).mutation(async ({ ctx, input }) => createCrmSequence({ ...input, actor: await actor(ctx) })),
  approveSequence: authedQuery.input(z.object({ sequenceId: id })).mutation(async ({ ctx, input }) => approveCrmSequence({ ...input, actor: await actor(ctx) })),
  advanceSequence: authedQuery.input(z.object({ sequenceId: id })).mutation(async ({ ctx, input }) => advanceCrmSequence({ ...input, actor: await actor(ctx) })),
  addNote: authedQuery.input(z.object({ opportunityId: id, body: z.string().trim().min(2).max(4000), visibility: z.enum(["team", "vendor"]), mentionedUserIds: z.array(id).max(10) })).mutation(async ({ ctx, input }) => addCrmCollaborationNote({ ...input, actor: await actor(ctx) })),
  detectDuplicates: authedQuery.input(z.object({ opportunityId: id })).mutation(async ({ ctx, input }) => detectCrmDuplicates({ ...input, actor: await actor(ctx) })),
  resolveDuplicate: authedQuery.input(z.object({ reviewId: id, state: z.enum(["confirmed_duplicate", "not_duplicate"]), reason: z.string().trim().min(5).max(500) })).mutation(async ({ ctx, input }) => resolveCrmDuplicate({ ...input, actor: await actor(ctx) })),
  addInfluence: authedQuery.input(z.object({ opportunityId: id, campaignId: id.optional(), promotionId: id.optional(), touchType: text(60), occurredAt: z.coerce.date(), evidenceRef: text(120) })).mutation(async ({ ctx, input }) => addCrmInfluence({ ...input, actor: await actor(ctx) })),
  createRoutingRule: authedQuery.input(z.object({ name: text(), campusId: id.optional(), productId: id.optional(), maxOpenOpportunities: z.number().int().min(1).max(10000), priority: z.number().int().min(1).max(10000) })).mutation(async ({ ctx, input }) => createCrmRoutingRule({ ...input, actor: await actor(ctx) })),
  proposeRouting: authedQuery.input(z.object({ opportunityId: id })).mutation(async ({ ctx, input }) => proposeCrmRouting({ ...input, actor: await actor(ctx) })),
  applyRouting: authedQuery.input(z.object({ decisionId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => applyCrmRouting({ ...input, actor: await actor(ctx) })),
  recordFeedback: authedQuery.input(z.object({ opportunityId: id, subjectToken: z.string().min(8).max(200), category: text(60), rating: z.number().int().min(1).max(5), comment: z.string().trim().min(2).max(4000), source: text(60) })).mutation(async ({ ctx, input }) => recordCrmFeedback({ ...input, actor: await actor(ctx) })),
});
