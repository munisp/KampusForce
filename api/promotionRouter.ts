import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import {
  changePromotionState,
  createPromotion,
  createPromotionLink,
  createPromotionRecruitmentInvite,
  listPromotionWorkspace,
  recordPromotionConsent,
  requestPromotionDelivery,
  reviewPromotion,
  runPromotionScheduleSweep,
  setPromotionTrigger,
  submitPromotionReview,
} from "./services/promotions";

const id = z.number().int().positive();
const channel = z.enum(["email", "sms", "whatsapp"]);

export const promotionRouter = createRouter({
  workspace: authedQuery.query(async ({ ctx }) => listPromotionWorkspace(await salesActorForUser(ctx.user))),
  create: authedQuery.input(z.object({
    name: z.string().trim().min(3).max(180),
    productId: id,
    campusId: id.optional(),
    brief: z.string().trim().min(20).max(6000),
    budgetCapKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recruitmentTarget: z.number().int().min(1).max(10_000),
    staffingWarningPct: z.number().int().min(50).max(100),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })).mutation(async ({ ctx, input }) => createPromotion({ ...input, actor: await salesActorForUser(ctx.user) })),
  submit: authedQuery.input(z.object({ promotionId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) =>
    submitPromotionReview({ ...input, actor: await salesActorForUser(ctx.user) })),
  review: authedQuery.input(z.object({ promotionId: id, decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(3).max(1000) })).mutation(async ({ ctx, input }) =>
    reviewPromotion({ ...input, actor: await salesActorForUser(ctx.user) })),
  changeState: authedQuery.input(z.object({ promotionId: id, action: z.enum(["start", "pause", "resume", "end"]) })).mutation(async ({ ctx, input }) =>
    changePromotionState({ ...input, actor: await salesActorForUser(ctx.user) })),
  setTrigger: authedQuery.input(z.object({ ruleId: id, enabled: z.boolean() })).mutation(async ({ ctx, input }) =>
    setPromotionTrigger({ ...input, actor: await salesActorForUser(ctx.user) })),
  runSweep: authedQuery.mutation(async ({ ctx }) => {
    const actor = await salesActorForUser(ctx.user);
    if (!["ops", "admin"].includes(actor.role)) throw new Error("Only Operations can run the orchestration sweep");
    return runPromotionScheduleSweep();
  }),
  createLink: authedQuery.input(z.object({ promotionId: id })).mutation(async ({ ctx, input }) => {
    const origin = ctx.req.headers.get("origin") || `${ctx.req.headers.get("x-forwarded-proto") || "http"}://${ctx.req.headers.get("host")}`;
    return createPromotionLink({ ...input, origin, actor: await salesActorForUser(ctx.user) });
  }),
  invite: authedQuery.input(z.object({
    promotionId: id,
    name: z.string().trim().min(3).max(160),
    phone: z.string().trim().min(7).max(20),
    note: z.string().trim().max(500).optional(),
    consentConfirmed: z.literal(true),
  })).mutation(async ({ ctx, input }) => createPromotionRecruitmentInvite({ ...input, actor: await salesActorForUser(ctx.user) })),
  consent: authedQuery.input(z.object({
    promotionId: id,
    customerRef: z.string().trim().min(3).max(160),
    channel,
    state: z.enum(["consented", "suppressed"]),
    evidenceRef: z.string().trim().min(3).max(240),
    policyVersion: z.string().trim().min(2).max(80),
  })).mutation(async ({ ctx, input }) => recordPromotionConsent({ ...input, actor: await salesActorForUser(ctx.user) })),
  requestDelivery: authedQuery.input(z.object({ promotionId: id, channel, mode: z.enum(["sandbox", "live"]) })).mutation(async ({ ctx, input }) =>
    requestPromotionDelivery({ ...input, actor: await salesActorForUser(ctx.user) })),
});
