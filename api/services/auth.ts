import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authSessions, users, type User } from "@db/schema";
import { getDb } from "../queries/connection";
import { publicQuery } from "../middleware";
import { env } from "../lib/env";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "kampusforce-sandbox-auth-secret-change-in-production");
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueToken(userId: number) {
  const token = await new SignJWT({ sub: String(userId), typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("kampusforce")
    .setExpirationTime("12h")
    .sign(secret);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await getDb().insert(authSessions).values({ userId, tokenHash: tokenHash(token), expiresAt });
  return { token, expiresAt };
}

export async function userFromToken(token: string): Promise<User> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: "kampusforce" });
    const userId = Number(payload.sub);
    const [session] = await getDb().select().from(authSessions)
      .where(and(eq(authSessions.tokenHash, tokenHash(token)), eq(authSessions.userId, userId), gt(authSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) throw new Error("Session expired");
    const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found");
    return user;
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Your session is invalid or has expired. Sign in again." });
  }
}

export const authedQuery = publicQuery
  .input(z.object({ token: z.string().min(40) }))
  .use(async ({ ctx, input, next }) => {
    const user = await userFromToken(input.token);
    return next({ ctx: { ...ctx, user } });
  });

export function requireRole(user: User, roles: User["role"][]) {
  if (!roles.includes(user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this workspace" });
}

export function requireSandboxAuthentication() {
  if (!env.sandboxMode) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox authentication is disabled. Configure a production identity provider before enabling public sign-in." });
  }
}

export async function invalidateToken(token: string) {
  const { eq } = await import("drizzle-orm");
  await getDb().delete(authSessions).where(eq(authSessions.tokenHash, tokenHash(token)));
}

