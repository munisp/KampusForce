import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { buildAdvancedAnalytics, captureAnalyticsSnapshot } from "./services/advancedAnalytics";
import { architectureReadiness } from "./services/architectureReadiness";
import { dispatchFinancialOutbox, reconcileTigerBeetleShadow } from "./services/tigerBeetle";
import { createMojaloopPreflightIntent } from "./services/mojaloop";

const windowInput = z.object({ windowDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30) });

export const architectureRouter = createRouter({
  overview: authedQuery.input(windowInput).query(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    const [analytics, architecture] = await Promise.all([buildAdvancedAnalytics(input.windowDays), architectureReadiness()]);
    return { analytics, architecture };
  }),
  captureSnapshot: authedQuery.input(windowInput).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return captureAnalyticsSnapshot(input.windowDays, ctx.user.id);
  }),
  dispatchTigerBeetle: authedQuery.input(z.object({ limit: z.number().int().min(1).max(100).default(10) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["finance", "admin"]);
    return dispatchFinancialOutbox(input.limit);
  }),
  reconcileTigerBeetle: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["finance", "admin"]);
    return reconcileTigerBeetleShadow();
  }),
  mojaloopPreflight: authedQuery.input(z.object({ payoutId: z.number().int().positive(), partyRefHash: z.string().regex(/^[a-f0-9]{64}$/) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["finance", "admin"]);
    return createMojaloopPreflightIntent({ ...input, actorUserId: ctx.user.id });
  }),
});
