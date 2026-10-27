import { and, desc, eq, isNull } from "drizzle-orm";
import { notifications, users } from "@db/schema";
import { getDb } from "../queries/connection";

export async function notifyUser(input: {
  userId: number;
  type: string;
  title: string;
  body: string;
  href?: string;
  entityType?: string;
  entityId?: string | number;
}) {
  const [{ id }] = await getDb().insert(notifications).values({
    ...input,
    entityId: input.entityId === undefined ? null : String(input.entityId),
  }).returning({ id: notifications.id });
  return id;
}

export async function notifyOperations(input: Omit<Parameters<typeof notifyUser>[0], "userId">) {
  const recipients = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "ops"));
  await Promise.all(recipients.map(({ id }) => notifyUser({ ...input, userId: id })));
  return recipients.length;
}

export async function listNotifications(userId: number) {
  const rows = await getDb().select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(50);
  return { notifications: rows, unread: rows.filter((row) => !row.readAt).length };
}

export async function markNotificationRead(userId: number, notificationId: number) {
  const now = new Date();
  const updated = await getDb().update(notifications).set({ readAt: now })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { read: updated.length > 0, notificationId, readAt: updated.length ? now : null };
}
