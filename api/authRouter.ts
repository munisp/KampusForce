import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { campuses, otpChallenges, reps, users } from "@db/schema";
import { createRouter, publicQuery } from "./middleware";
import { authedQuery, invalidateToken, issueToken } from "./services/auth";
import { normalizePhone } from "./services/security";
import { getDb } from "./queries/connection";

const codeHash = (code: string) => createHash("sha256").update(`kf-otp:${code}`).digest("hex");

async function createRepIfNeeded(userId: number) {
  const db = getDb();
  const [existing] = await db.select().from(reps).where(eq(reps.userId, userId)).limit(1);
  if (existing) return existing;
  let [campus] = await db.select().from(campuses).where(eq(campuses.name, "University of Lagos")).limit(1);
  if (!campus) {
    const [{ id }] = await db.insert(campuses).values({ name: "University of Lagos", state: "Lagos", status: "live" }).returning({ id: campuses.id });
    [campus] = await db.select().from(campuses).where(eq(campuses.id, id)).limit(1);
  }
  const count = (await db.select().from(reps)).length + 1;
  const code = `KF-UNILAG-${String(count).padStart(4, "0")}`;
  const [{ id }] = await db.insert(reps).values({ userId, campusId: campus.id, code, status: "pending" }).returning({ id: reps.id });
  const [rep] = await db.select().from(reps).where(eq(reps.id, id)).limit(1);
  return rep;
}

export const authRouter = createRouter({
  requestOtp: publicQuery.input(z.object({ phone: z.string().min(10).max(20) })).mutation(async ({ input }) => {
    const phone = normalizePhone(input.phone);
    const code = String(randomInt(100000, 1000000));
    await getDb().insert(otpChallenges).values({ phoneE164: phone, codeHash: codeHash(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { accepted: true, expiresInSeconds: 600, delivery: "sandbox_sms", sandboxCode: code };
  }),
  verifyOtp: publicQuery.input(z.object({ phone: z.string(), code: z.string().length(6), name: z.string().min(2).max(160).optional() })).mutation(async ({ input }) => {
    const phone = normalizePhone(input.phone);
    const db = getDb();
    const [challenge] = await db.select().from(otpChallenges).where(and(eq(otpChallenges.phoneE164, phone), isNull(otpChallenges.verifiedAt), gt(otpChallenges.expiresAt, new Date()))).orderBy(desc(otpChallenges.createdAt)).limit(1);
    if (!challenge || challenge.codeHash !== codeHash(input.code) || challenge.attempts >= 5) throw new TRPCError({ code: "BAD_REQUEST", message: "The code is invalid or expired" });
    await db.update(otpChallenges).set({ verifiedAt: new Date(), attempts: challenge.attempts + 1 }).where(eq(otpChallenges.id, challenge.id));
    let [user] = await db.select().from(users).where(eq(users.phoneE164, phone)).limit(1);
    if (!user) {
      const [{ id }] = await db.insert(users).values({ phoneE164: phone, name: input.name || "New KampusForce rep", role: "rep" }).returning({ id: users.id });
      [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    }
    const rep = user.role === "rep" ? await createRepIfNeeded(user.id) : null;
    return { ...(await issueToken(user.id)), user, rep };
  }),
  demoLogin: publicQuery.input(z.object({ role: z.enum(["rep", "vendor", "ops", "finance"]), repCode: z.string().max(32).optional() })).mutation(async ({ input }) => {
    const [user] = input.repCode
      ? await getDb().select({ user: users }).from(users).innerJoin(reps, eq(reps.userId, users.id)).where(and(eq(users.role, input.role), eq(reps.code, input.repCode))).limit(1).then((rows) => rows.map((row) => row.user))
      : await getDb().select().from(users).where(eq(users.role, input.role)).limit(1);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox user not found. Run the database seed." });
    return { ...(await issueToken(user.id)), user };
  }),
  me: authedQuery.query(({ ctx }) => ({ user: ctx.user })),
  logout: authedQuery.mutation(async ({ input }) => { await invalidateToken(input.token); return { signedOut: true }; }),
});
