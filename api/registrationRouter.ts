import { randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { auditLogs, campuses, escrowWallets, otpChallenges, reps, users, vendors, vendorWebhookCredentials } from "@db/schema";
import { createRouter, publicQuery } from "./middleware";
import { codeHash, matchingCode } from "./authRouter";
import { getDb } from "./queries/connection";
import { ensureIdentityCase } from "./services/identity";
import { createSignInAccount, deleteSignInAccount, keycloakAdminConfigured } from "./services/keycloakAdmin";
import { oidcConfig } from "./services/oidc";
import { normalizePhone } from "./services/security";

// How a phone code reaches the person. "screen" shows it on the page: for testing only, because it proves nothing
// about who holds the phone. It is refused in live mode. Unset means registration is closed.
function otpDelivery() {
  const mode = (process.env.KF_OTP_DELIVERY || "").trim();
  if (mode === "screen" && (process.env.KF_PROVIDER_MODE || "sandbox") !== "live") return "screen" as const;
  return null;
}

function phoneOf(input: string) {
  try {
    return normalizePhone(input);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid Nigerian phone number, like 0803 000 0000" });
  }
}

function registrationOpen() {
  if (!oidcConfig() || !keycloakAdminConfigured() || !otpDelivery()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Registration is not open yet." });
  }
}

const person = {
  phone: z.string().min(10).max(20),
  code: z.string().length(6),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
  termsAccepted: z.literal(true),
};

export const registrationRouter = createRouter({
  options: publicQuery.query(async () => ({
    open: Boolean(oidcConfig() && keycloakAdminConfigured() && otpDelivery()),
    testMode: otpDelivery() === "screen",
    campuses: await getDb().select({ id: campuses.id, name: campuses.name, state: campuses.state }).from(campuses).orderBy(campuses.name),
  })),

  sendCode: publicQuery.input(z.object({ phone: z.string().min(10).max(20) })).mutation(async ({ input }) => {
    registrationOpen();
    const phone = phoneOf(input.phone);
    const code = String(randomInt(100000, 1000000));
    await getDb().insert(otpChallenges).values({ phoneE164: phone, codeHash: codeHash(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { accepted: true, expiresInSeconds: 600, testCode: otpDelivery() === "screen" ? code : undefined };
  }),

  complete: publicQuery.input(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("student"), ...person, campusId: z.number().int().positive() }),
    z.object({ kind: z.literal("vendor"), ...person, companyName: z.string().trim().min(2).max(180), cacNumber: z.string().trim().min(2).max(40) }),
  ])).mutation(async ({ input }) => {
    registrationOpen();
    const phone = phoneOf(input.phone);
    const db = getDb();

    // The code is checked first, so nothing about an account is revealed to someone who doesn't hold the phone. It
    // is only used up once everything has worked: a taken email address shouldn't cost a new code.
    const challenge = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(otpChallenges).where(and(
        eq(otpChallenges.phoneE164, phone), isNull(otpChallenges.verifiedAt), gt(otpChallenges.expiresAt, new Date()),
      )).orderBy(desc(otpChallenges.createdAt)).limit(1).for("update");
      if (!current || current.attempts >= 5) return null;
      if (!matchingCode(codeHash(input.code), current.codeHash)) {
        await tx.update(otpChallenges).set({ attempts: current.attempts + 1 }).where(eq(otpChallenges.id, current.id));
        return null;
      }
      return current;
    });
    if (!challenge) throw new TRPCError({ code: "BAD_REQUEST", message: "The code is invalid, expired, or has too many failed attempts. Send a new one." });

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phoneE164, phone)).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "An account already exists for this phone number. Sign in instead." });
    if (input.kind === "student") {
      const [campus] = await db.select({ id: campuses.id }).from(campuses).where(eq(campuses.id, input.campusId)).limit(1);
      if (!campus) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose your campus from the list." });
    }

    const name = `${input.firstName} ${input.lastName}`;
    const role = input.kind === "vendor" ? "vendor" as const : "rep" as const;
    const accountId = await createSignInAccount({ email: input.email, firstName: input.firstName, lastName: input.lastName, password: input.password, phoneE164: phone, role });
    try {
      await db.transaction(async (tx) => {
        const used = await tx.update(otpChallenges).set({ verifiedAt: new Date(), attempts: challenge.attempts + 1 })
          .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.verifiedAt))).returning({ id: otpChallenges.id });
        if (!used.length) throw new TRPCError({ code: "CONFLICT", message: "This code has already been used. Send a new one." });
        const [user] = await tx.insert(users).values({ phoneE164: phone, name: input.kind === "vendor" ? input.companyName : name, role }).returning();
        if (input.kind === "student") {
          await tx.insert(reps).values({ userId: user.id, campusId: input.campusId, code: `KF-${randomBytes(6).toString("hex").toUpperCase()}`, status: "pending", contractorAgreementSignedAt: new Date() });
          await ensureIdentityCase({ caseType: "representative_kyc", subjectType: "user", subjectId: user.id, requestedByUserId: user.id, campusId: input.campusId, triggerEvent: "rep.self_registered" }, tx);
        } else {
          const secret = randomBytes(48).toString("hex");
          const [vendor] = await tx.insert(vendors).values({
            userId: user.id, companyName: input.companyName, cacNumber: input.cacNumber, contactEmail: input.email,
            webhookKey: `vk_${randomBytes(16).toString("hex")}`, webhookSecret: secret, status: "pending",
          }).returning();
          await tx.insert(vendorWebhookCredentials).values({ vendorId: vendor.id, keyVersion: 1, secret, state: "active" });
          await tx.insert(escrowWallets).values({ vendorId: vendor.id, balanceKobo: 0 });
          await ensureIdentityCase({ caseType: "vendor_kyb", subjectType: "vendor", subjectId: vendor.id, requestedByUserId: user.id, triggerEvent: "vendor.activation_requested" }, tx);
        }
        await tx.insert(auditLogs).values({ actorUserId: user.id, action: "registration.completed", entityType: "user", entityId: String(user.id), metadataJson: { kind: input.kind, otpDelivery: otpDelivery() } });
      });
    } catch (error) {
      await deleteSignInAccount(accountId).catch(() => undefined);
      throw error;
    }
    return { registered: true, kind: input.kind };
  }),
});
