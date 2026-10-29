import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import {
  acceptCaseCopilot,
  applyCaseRouting,
  applyCaseSlaPolicy,
  approveKnowledgeArticle,
  caseAttachmentUrl,
  createCaseRoutingRule,
  createCaseSlaPolicy,
  createKnowledgeArticle,
  createMajorIncident,
  createProblemRecord,
  deleteCaseAttachment,
  intakeCaseChannel,
  linkCaseKnowledge,
  linkProblemCase,
  listCaseInnovationWorkspace,
  proposeCaseRouting,
  recordCaseExperience,
  reviewCaseQuality,
  runCaseCopilot,
  setCaseAgentSkill,
  setCaseWaiting,
  suggestCaseKnowledge,
  updateMajorIncident,
  updateProblemRecord,
  uploadCaseAttachment,
} from "./services/caseInnovations";

const id = z.number().int().positive();
const text = (max = 160) => z.string().trim().min(2).max(max);
const actor = async (ctx: { user: Parameters<typeof salesActorForUser>[0] }) => salesActorForUser(ctx.user);

export const caseInnovationRouter = createRouter({
  workspace: authedQuery.query(async ({ ctx }) => listCaseInnovationWorkspace(await actor(ctx))),
  intake: authedQuery.input(z.object({ channel: z.enum(["email", "sms", "whatsapp", "web"]), externalId: z.string().min(3).max(300), repId: id, vendorId: id, customerPhone: z.string().min(8).max(20), category: text(80), subject: text(180), description: z.string().trim().min(5).max(8000) })).mutation(async ({ ctx, input }) => intakeCaseChannel({ ...input, actor: await actor(ctx) })),
  setAgentSkill: authedQuery.input(z.object({ userId: id, skill: text(80), level: z.number().int().min(0).max(100), active: z.boolean() })).mutation(async ({ ctx, input }) => setCaseAgentSkill({ ...input, actor: await actor(ctx) })),
  createRoutingRule: authedQuery.input(z.object({ name: text(), category: text(80).optional(), vendorId: id.optional(), skill: text(80), maxOpenCases: z.number().int().min(1).max(10000), priority: z.number().int().min(1).max(10000) })).mutation(async ({ ctx, input }) => createCaseRoutingRule({ ...input, actor: await actor(ctx) })),
  proposeRouting: authedQuery.input(z.object({ ticketId: id })).mutation(async ({ ctx, input }) => proposeCaseRouting({ ...input, actor: await actor(ctx) })),
  applyRouting: authedQuery.input(z.object({ decisionId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => applyCaseRouting({ ...input, actor: await actor(ctx) })),
  createSlaPolicy: authedQuery.input(z.object({ name: text(), priority: z.enum(["normal", "urgent"]), firstResponseMinutes: z.number().int().min(1).max(10080), resolutionMinutes: z.number().int().min(1).max(43200), businessStartMinute: z.number().int().min(0).max(1439), businessEndMinute: z.number().int().min(1).max(1440), businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7) })).mutation(async ({ ctx, input }) => createCaseSlaPolicy({ ...input, actor: await actor(ctx) })),
  applySlaPolicy: authedQuery.input(z.object({ ticketId: id, policyId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => applyCaseSlaPolicy({ ...input, actor: await actor(ctx) })),
  setWaiting: authedQuery.input(z.object({ ticketId: id, waiting: z.boolean(), reason: z.string().trim().min(3).max(500) })).mutation(async ({ ctx, input }) => setCaseWaiting({ ...input, actor: await actor(ctx) })),
  uploadAttachment: authedQuery.input(z.object({ ticketId: id, messageId: id.optional(), fileName: z.string().trim().min(1).max(255), contentBase64: z.string().min(4).max(140_000_000), contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv"]), visibility: z.enum(["internal", "public"]) })).mutation(async ({ ctx, input }) => uploadCaseAttachment({ ...input, actor: await actor(ctx) })),
  attachmentUrl: authedQuery.input(z.object({ attachmentId: id })).query(async ({ ctx, input }) => caseAttachmentUrl({ ...input, actor: await actor(ctx) })),
  deleteAttachment: authedQuery.input(z.object({ attachmentId: id })).mutation(async ({ ctx, input }) => deleteCaseAttachment({ ...input, actor: await actor(ctx) })),
  createArticle: authedQuery.input(z.object({ articleKey: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,79}$/), title: text(200), category: text(80), body: z.string().trim().min(20).max(20000), keywords: z.array(z.string().trim().min(2).max(60)).max(20) })).mutation(async ({ ctx, input }) => createKnowledgeArticle({ ...input, actor: await actor(ctx) })),
  approveArticle: authedQuery.input(z.object({ articleId: id })).mutation(async ({ ctx, input }) => approveKnowledgeArticle({ ...input, actor: await actor(ctx) })),
  suggestKnowledge: authedQuery.input(z.object({ ticketId: id })).query(async ({ ctx, input }) => suggestCaseKnowledge({ ...input, actor: await actor(ctx) })),
  linkKnowledge: authedQuery.input(z.object({ ticketId: id, articleId: id, helpful: z.boolean().optional() })).mutation(async ({ ctx, input }) => linkCaseKnowledge({ ...input, actor: await actor(ctx) })),
  createProblem: authedQuery.input(z.object({ title: text(200), ownerUserId: id.optional() })).mutation(async ({ ctx, input }) => createProblemRecord({ ...input, actor: await actor(ctx) })),
  linkProblem: authedQuery.input(z.object({ problemId: id, ticketId: id })).mutation(async ({ ctx, input }) => linkProblemCase({ ...input, actor: await actor(ctx) })),
  updateProblem: authedQuery.input(z.object({ problemId: id, state: z.enum(["investigating", "known_error", "resolved"]), rootCause: z.string().trim().max(8000).optional(), workaround: z.string().trim().max(8000).optional() })).mutation(async ({ ctx, input }) => updateProblemRecord({ ...input, actor: await actor(ctx) })),
  createIncident: authedQuery.input(z.object({ title: text(200), severity: z.enum(["sev1", "sev2"]), commanderUserId: id, problemId: id.optional() })).mutation(async ({ ctx, input }) => createMajorIncident({ ...input, actor: await actor(ctx) })),
  updateIncident: authedQuery.input(z.object({ incidentId: id, state: z.enum(["investigating", "monitoring", "resolved"]), body: z.string().trim().min(5).max(4000), visibility: z.enum(["internal", "public"]) })).mutation(async ({ ctx, input }) => updateMajorIncident({ ...input, actor: await actor(ctx) })),
  reviewQuality: authedQuery.input(z.object({ ticketId: id, scores: z.record(z.string(), z.number().min(0).max(20)), coachingNote: z.string().trim().min(5).max(4000) })).mutation(async ({ ctx, input }) => reviewCaseQuality({ ...input, actor: await actor(ctx) })),
  recordExperience: authedQuery.input(z.object({ ticketId: id, respondentToken: z.string().min(8).max(200), csat: z.number().int().min(1).max(5), effort: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) => recordCaseExperience({ ...input, actor: await actor(ctx) })),
  runCopilot: authedQuery.input(z.object({ ticketId: id })).mutation(async ({ ctx, input }) => runCaseCopilot({ ...input, actor: await actor(ctx) })),
  acceptCopilot: authedQuery.input(z.object({ runId: id })).mutation(async ({ ctx, input }) => acceptCaseCopilot({ ...input, actor: await actor(ctx) })),
});
