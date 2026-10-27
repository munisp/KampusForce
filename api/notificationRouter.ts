import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notifications } from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { getDb } from "./queries/connection";
import { listNotifications, markNotificationRead } from "./services/notifications";

export const notificationRouter = createRouter({
  list: authedQuery.query(({ ctx }) => listNotifications(ctx.user.id)),
  read: authedQuery.input(z.object({ notificationId: z.number().int().positive() })).mutation(({ ctx, input }) => markNotificationRead(ctx.user.id, input.notificationId)),
  readAll: authedQuery.mutation(async ({ ctx }) => {
    const now = new Date();
    const updated = await getDb().update(notifications).set({ readAt: now }).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt))).returning({ id: notifications.id });
    return { read: updated.length, readAt: now };
  }),
});
