import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { campusLeadAssignments, reps, users, vendors, type User } from "@db/schema";
import { getDb } from "../queries/connection";

export type SalesActor = {
  userId: number;
  role: User["role"];
  repId?: number;
  campusId?: number;
  vendorId?: number;
  tier?: string;
};

export async function salesActorForUser(user: User): Promise<SalesActor> {
  const db = getDb();
  const [rep] = await db.select().from(reps).where(eq(reps.userId, user.id)).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.userId, user.id)).limit(1);
  return {
    userId: user.id,
    role: user.role,
    repId: rep?.id,
    campusId: rep?.campusId,
    tier: rep?.tier,
    vendorId: vendor?.id,
  };
}

export function assertSalesRole(actor: SalesActor, roles: SalesActor["role"][]) {
  if (!roles.includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Your workspace role cannot perform this sales action" });
}

export async function actorRepIds(actor: SalesActor) {
  if (!actor.repId) return [] as number[];
  if (actor.tier !== "campus_lead") return [actor.repId];
  const assignments = await getDb().select({ repId: campusLeadAssignments.repId }).from(campusLeadAssignments)
    .where(and(eq(campusLeadAssignments.leadRepId, actor.repId), isNull(campusLeadAssignments.revokedAt)));
  return [...new Set([actor.repId, ...assignments.map((row) => row.repId)])];
}

export async function canActorAccessRep(actor: SalesActor, repId: number) {
  if (["ops", "finance", "admin"].includes(actor.role)) return true;
  if (!actor.repId) return false;
  return (await actorRepIds(actor)).includes(repId);
}

export async function assigneeOptions(actor: SalesActor) {
  if (["ops", "finance", "admin"].includes(actor.role)) {
    return getDb().select({ id: users.id, name: users.name, role: users.role }).from(users)
      .where(eq(users.role, "ops")).orderBy(users.name);
  }
  if (actor.role === "vendor") {
    const [user] = await getDb().select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, actor.userId)).limit(1);
    return user ? [user] : [];
  }
  const [user] = await getDb().select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, actor.userId)).limit(1);
  return user ? [user] : [];
}
