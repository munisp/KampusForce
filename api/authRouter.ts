import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { campuses, otpChallenges, reps, users } from "@db/schema";
import { createRouter, publicQuery } from "./middleware";
import { authedQuery, invalidateToken, issueToken, requireSandboxAuthentication } from "./services/auth";
import { normalizePhone } from "./services/security";
import { getDb } from "./queries/connection";

const otpSecret = process.env.AUTH_SECRET || "kampusforce-sandbox-auth-secret-change-in-production";
const codeHash = (code: string) => createHmac("sha256", otpSecret).update(`kf-otp:${code}`).digest("hex");
const matchingCode = (receivedHash: string, expectedHash: string) => {
  const received = Buffer.from(receivedHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export const authRouter = createRouter({
  requestOtp: publicQuery.input(z.object({ phone: z.string().min(10).max(20) })).mutation(async ({ input }) => {
    requireSandboxAuthentication();
    const phone = normalizePhone(input.phone);
    const code = String(randomInt(100000, 1000000));
    await getDb().insert(otpChallenges).values({ phoneE164: phone, codeHash: codeHash(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { accepted: true, expiresInSeconds: 600, delivery: "sandbox_sms", sandboxCode: code };
  }),
  verifyOtp: publicQuery.input(z.object({ phone: z.string(), code: z.string().length(6), name: z.string().min(2).max(160).optional() })).mutation(async ({ input }) => {
    requireSandboxAuthentication();
    const phone = normalizePhone(input.phone);
    const verification = await getDb().transaction(async (tx) => {
      const [challenge] = await tx.select().from(otpChallenges).where(and(
        eq(otpChallenges.phoneE164, phone),
        isNull(otpChallenges.verifiedAt),
        gt(otpChallenges.expiresAt, new Date()),
      )).orderBy(desc(otpChallenges.createdAt)).limit(1).for("update");

      if (!challenge || challenge.attempts >= 5) return { ok: false as const };
      if (!matchingCode(codeHash(input.code), challenge.codeHash)) {
        await tx.update(otpChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(otpChallenges.id, challenge.id));
        return { ok: false as const };
      }

      await tx.update(otpChallenges).set({ verifiedAt: new Date(), attempts: challenge.attempts + 1 }).where(eq(otpChallenges.id, challenge.id));
      await tx.insert(users).values({
        phoneE164: phone,
        name: input.name || "New KampusForce rep",
        role: "rep",
      }).onConflictDoNothing({ target: users.phoneE164 });
      const [user] = await tx.select().from(users).where(eq(users.phoneE164, phone)).limit(1).for("update");
      if (!user) throw new Error("Verified user could not be loaded");

      let rep: typeof reps.$inferSelect | null = null;
      if (user.role === "rep") {
        [rep] = await tx.select().from(reps).where(eq(reps.userId, user.id)).limit(1);
        if (!rep) {
          await tx.insert(campuses).values({ name: "University of Lagos", state: "Lagos", status: "live" })
            .onConflictDoNothing({ target: campuses.name });
          const [campus] = await tx.select().from(campuses).where(eq(campuses.name, "University of Lagos")).limit(1);
          if (!campus) throw new Error("Default campus could not be loaded");
          const code = `KF-UNILAG-${randomBytes(6).toString("hex").toUpperCase()}`;
          [rep] = await tx.insert(reps).values({ userId: user.id, campusId: campus.id, code, status: "pending" }).returning();
        }
      }
      return { ok: true as const, user, rep };
    });

    if (!verification.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "The code is invalid, expired, or has too many failed attempts" });
    return { ...(await issueToken(verification.user.id)), user: verification.user, rep: verification.rep };
  }),
  demoLogin: publicQuery.input(z.object({ role: z.enum(["rep", "vendor", "ops", "finance"]), repCode: z.string().max(32).optional() })).mutation(async ({ input }) => {
    requireSandboxAuthentication();
    const [user] = input.repCode
      ? await getDb().select({ user: users }).from(users).innerJoin(reps, eq(reps.userId, users.id)).where(and(eq(users.role, input.role), eq(reps.code, input.repCode))).limit(1).then((rows) => rows.map((row) => row.user))
      : await getDb().select().from(users).where(eq(users.role, input.role)).limit(1);
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox user not found. Run the database seed." });
    return { ...(await issueToken(user.id)), user };
  }),
  me: authedQuery.query(({ ctx }) => ({ user: ctx.user })),
  logout: authedQuery.mutation(async ({ input }) => { await invalidateToken(input.token); return { signedOut: true }; }),
});
