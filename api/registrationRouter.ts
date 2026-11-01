import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { auditLogs, campuses, campusInterest, escrowWallets, reps, users, vendors, vendorWebhookCredentials } from "@db/schema";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { ensureIdentityCase } from "./services/identity";
import { createSignInAccount, deleteSignInAccount, keycloakAdminConfigured, sendAccountEmail } from "./services/keycloakAdmin";
import { log } from "./lib/logger";
import { oidcConfig } from "./services/oidc";

const person = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  termsAccepted: z.literal(true),
  // An in-app page to come back to after verifying: only a recruiting invitation.
  returnTo: z.string().max(400).regex(/^\/recruit\/accept\?token=[\w%.~-]+$/).optional(),
};

// Students can register only where KampusForce is open.
const OPEN_CAMPUS = ["live", "launching"] as const;

export const registrationRouter = createRouter({
  options: publicQuery.query(async () => ({
    open: Boolean(oidcConfig() && keycloakAdminConfigured()),
    campuses: await getDb().select({ id: campuses.id, name: campuses.name, state: campuses.state }).from(campuses).where(inArray(campuses.status, [...OPEN_CAMPUS])).orderBy(campuses.name),
  })),

  // Same answer whether or not this person has asked before.
  registerInterest: publicQuery.input(z.object({
    university: z.string().trim().min(3).max(160),
    state: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
  })).mutation(async ({ input }) => {
    await getDb().insert(campusInterest).values(input).onConflictDoNothing();
    return { recorded: true };
  }),

  // Answers the same whether or not the email is already registered, so it can't be used to find out who has an account.
  complete: publicQuery.input(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("student"), ...person, campusId: z.number().int().positive() }),
    z.object({ kind: z.literal("vendor"), ...person, companyName: z.string().trim().min(2).max(180), cacNumber: z.string().trim().min(2).max(40) }),
  ])).mutation(async ({ input }) => {
    if (!oidcConfig() || !keycloakAdminConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Registration is not open yet." });
    const db = getDb();
    if (input.kind === "student") {
      const [campus] = await db.select({ id: campuses.id }).from(campuses).where(and(eq(campuses.id, input.campusId), inArray(campuses.status, [...OPEN_CAMPUS]))).limit(1);
      if (!campus) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose your campus from the list." });
    }
    const appUrl = (process.env.KF_APP_URL || "").replace(/\/$/, "");
    const returnTo = `${appUrl}${input.returnTo || "/"}`;
    const answer = { registered: true, kind: input.kind };
    const [known] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    const role = input.kind === "vendor" ? "vendor" as const : "rep" as const;
    const accountId = await createSignInAccount({ email: input.email, firstName: input.firstName, lastName: input.lastName, role, returnTo });
    if (known || !accountId) return answer;
    try {
      await db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ email: input.email, name: input.kind === "vendor" ? input.companyName : `${input.firstName} ${input.lastName}`, role }).returning();
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
        await tx.insert(auditLogs).values({ actorUserId: user.id, action: "registration.completed", entityType: "user", entityId: String(user.id), metadataJson: { kind: input.kind } });
      });
    } catch (error) {
      await deleteSignInAccount(accountId).catch(() => undefined);
      throw error;
    }
    // Registering again sends the link again, so a mail failure here isn't a dead end.
    await sendAccountEmail(accountId, returnTo).catch((error) => log.error("registration email failed", { error: error instanceof Error ? error.message : String(error) }));
    return answer;
  }),
});
