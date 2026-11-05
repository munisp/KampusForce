import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, payoutDestinations, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { assertCurrentIdentityApproval, type IdentityClient } from "./identity";
import { compareAccountNames, listBanks, resolveBankAccount, takeLookupAllowance } from "./bankAccounts";

export type PayoutDestinationInput = {
  accountNumber: string;
  bankCode: string;
  accountName: string;
};

export function validatePayoutDestination(input: PayoutDestinationInput) {
  const accountNumber = input.accountNumber.trim();
  const bankCode = input.bankCode.trim();
  const accountName = input.accountName.trim().replace(/\s+/g, " ");
  if (!/^\d{10}$/.test(accountNumber)) throw new TRPCError({ code: "BAD_REQUEST", message: "A ten-digit NUBAN is required" });
  if (!/^[A-Za-z0-9-]{2,12}$/.test(bankCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "A valid bank code is required" });
  if (accountName.length < 3 || accountName.length > 160) throw new TRPCError({ code: "BAD_REQUEST", message: "A verified account name between 3 and 160 characters is required" });
  return { accountNumber, bankCode, accountName };
}

function encryptionKey(env: NodeJS.ProcessEnv = process.env) {
  const encoded = (env.KF_PAYOUT_ENCRYPTION_KEY || "").trim();
  const key = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, "hex") : Buffer.from(encoded, "base64");
  if (!encoded || key.length !== 32) throw new Error("KF_PAYOUT_ENCRYPTION_KEY must contain exactly 32 bytes as hex or base64");
  return key;
}

function keyVersion(env: NodeJS.ProcessEnv = process.env) {
  const version = (env.KF_PAYOUT_ENCRYPTION_KEY_VERSION || "v1").trim();
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(version)) throw new Error("Payout encryption key version is invalid");
  return version;
}

function aad(userId: number) {
  return Buffer.from(`kampusforce:payout-destination:v1:${userId}`, "utf8");
}

function accountHash(userId: number, accountNumber: string, key: Buffer) {
  return createHmac("sha256", key).update(`kampusforce:payout-account:v1:${userId}:${accountNumber}`).digest("hex");
}

export function encryptPayoutAccountNumber(userId: number, accountNumber: string, env: NodeJS.ProcessEnv = process.env) {
  validatePayoutDestination({ accountNumber, bankCode: "999", accountName: "Encrypted payout recipient" });
  const key = encryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(accountNumber, "utf8"), cipher.final()]);
  return {
    accountNumberCiphertext: ciphertext.toString("base64"),
    accountNumberIv: iv.toString("base64"),
    accountNumberTag: cipher.getAuthTag().toString("base64"),
    accountNumberHash: accountHash(userId, accountNumber, key),
    keyVersion: keyVersion(env),
  };
}

function decryptPayoutAccountNumber(userId: number, row: typeof payoutDestinations.$inferSelect, env: NodeJS.ProcessEnv = process.env) {
  if (row.keyVersion !== keyVersion(env)) throw new Error("Payout destination uses a different encryption key version; complete controlled key rotation before dispatch");
  const key = encryptionKey(env);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.accountNumberIv, "base64"));
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(Buffer.from(row.accountNumberTag, "base64"));
  const accountNumber = Buffer.concat([decipher.update(Buffer.from(row.accountNumberCiphertext, "base64")), decipher.final()]).toString("utf8");
  if (!/^\d{10}$/.test(accountNumber) || accountHash(userId, accountNumber, key) !== row.accountNumberHash) {
    throw new Error("Payout destination integrity verification failed");
  }
  return accountNumber;
}

const USABLE_CHECKS = ["matched", "approved"];

/**
 * Saves a rep's payout account after asking the bank (through Paystack) whose account it is. The rep only chooses a
 * bank and types the number; the account name always comes from the bank and is compared with the name Operations
 * confirmed on the rep's ID check. A close-but-not-certain name goes to Operations instead of being refused.
 */
export async function configurePayoutDestination(userId: number, input: { accountNumber: string; bankCode: string }) {
  const accountNumber = input.accountNumber.trim();
  const bankCode = input.bankCode.trim();
  await assertCanSetUpBankAccount(userId);
  const bank = (await listBanks()).find((b) => b.code === bankCode);
  if (!bank) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose your bank from the list." });
  takeLookupAllowance(userId);
  const { accountName } = await resolveBankAccount(accountNumber, bankCode);
  const destination = validatePayoutDestination({ accountNumber, bankCode, accountName });
  return getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    if (!user || user.role !== "rep") throw new TRPCError({ code: "NOT_FOUND", message: "Representative profile not found" });
    await assertCurrentIdentityApproval({ subjectType: "user", subjectId: userId, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, tx);
    const check = compareAccountNames(user.name, destination.accountName);
    if (check === "no_match") {
      await tx.insert(auditLogs).values({ actorUserId: userId, action: "payout.destination_name_mismatch", entityType: "payout_destination", entityId: String(userId), metadataJson: { bankCode, accountLast4: accountNumber.slice(-4) } });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `This account is in the name ${destination.accountName}, which doesn't match the name on your ID check (${user.name}). Use an account in your own name.` });
    }
    const nameCheck = check === "match" ? "matched" : "review";
    const encrypted = encryptPayoutAccountNumber(userId, destination.accountNumber);
    const [existing] = await tx.select().from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
    const values = {
      ...encrypted,
      bankCode: destination.bankCode,
      bankName: bank.name,
      accountName: destination.accountName,
      accountLast4: destination.accountNumber.slice(-4),
      nameCheck,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNote: null,
      updatedAt: new Date(),
    };
    if (existing) {
      await tx.update(payoutDestinations).set({ ...values, version: existing.version + 1 }).where(eq(payoutDestinations.userId, userId));
    } else {
      await tx.insert(payoutDestinations).values({ userId, ...values });
    }
    if (nameCheck === "matched") {
      await tx.update(users).set({ bankName: bank.name, bankCode: destination.bankCode, bankAccountLast4: values.accountLast4, bankAccountName: destination.accountName, bankNameMatch: true }).where(eq(users.id, userId));
    } else {
      // A new account waiting for Operations replaces the old one, so payouts wait too.
      await tx.update(users).set({ bankNameMatch: false }).where(eq(users.id, userId));
    }
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: existing ? "payout.destination_replaced" : "payout.destination_configured",
      entityType: "payout_destination",
      entityId: String(userId),
      metadataJson: { bankCode: destination.bankCode, accountLast4: values.accountLast4, encryptedAtRest: true, fullAccountNumberPersisted: false, nameCheck, nameSource: "paystack_bank_resolve" },
    });
    return { configured: true as const, nameCheck, bankName: bank.name, accountName: destination.accountName, accountLast4: values.accountLast4, version: existing ? existing.version + 1 : 1 };
  });
}

/** Only a rep with an approved ID check may look accounts up: a lookup reveals who owns an account number. */
export async function assertCanSetUpBankAccount(userId: number) {
  const [user] = await getDb().select({ role: users.role, kycState: users.kycState }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.role !== "rep") throw new TRPCError({ code: "FORBIDDEN", message: "Only campus reps add a payout account." });
  if (user.kycState !== "verified") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add your bank account once Operations has approved your ID check." });
}

/** Shows the rep the account name the bank holds before they save it. */
export async function lookUpBankAccount(userId: number, input: { accountNumber: string; bankCode: string }) {
  await assertCanSetUpBankAccount(userId);
  const [user] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  takeLookupAllowance(userId);
  const { accountName } = await resolveBankAccount(input.accountNumber.trim(), input.bankCode.trim());
  return { accountName, nameCheck: compareAccountNames(user!.name, accountName) };
}

export async function payoutDestinationStatus(userId: number) {
  const [row] = await getDb().select({
    bankCode: payoutDestinations.bankCode,
    bankName: payoutDestinations.bankName,
    accountName: payoutDestinations.accountName,
    accountLast4: payoutDestinations.accountLast4,
    nameCheck: payoutDestinations.nameCheck,
    reviewNote: payoutDestinations.reviewNote,
    version: payoutDestinations.version,
    updatedAt: payoutDestinations.updatedAt,
  }).from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
  return row ? { configured: true as const, ...row, fullAccountNumberPersisted: false as const } : { configured: false as const, fullAccountNumberPersisted: false as const };
}

/** Payout accounts whose bank name only nearly matches the ID-checked name, for Operations to decide. */
export async function listBankAccountReviews() {
  return getDb().select({
    userId: payoutDestinations.userId,
    idName: users.name,
    email: users.email,
    bankName: payoutDestinations.bankName,
    bankCode: payoutDestinations.bankCode,
    accountName: payoutDestinations.accountName,
    accountLast4: payoutDestinations.accountLast4,
    updatedAt: payoutDestinations.updatedAt,
  }).from(payoutDestinations).innerJoin(users, eq(users.id, payoutDestinations.userId)).where(eq(payoutDestinations.nameCheck, "review")).orderBy(payoutDestinations.updatedAt);
}

export async function reviewBankAccount(input: { userId: number; approve: boolean; note: string; reviewerUserId: number }) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(payoutDestinations).where(eq(payoutDestinations.userId, input.userId)).limit(1).for("update");
    if (!row || row.nameCheck !== "review") throw new TRPCError({ code: "CONFLICT", message: "This bank account isn't waiting for a decision any more. Refresh the list." });
    const nameCheck = input.approve ? "approved" : "rejected";
    await tx.update(payoutDestinations).set({ nameCheck, reviewedByUserId: input.reviewerUserId, reviewedAt: new Date(), reviewNote: input.note }).where(eq(payoutDestinations.userId, input.userId));
    await tx.update(users).set(input.approve
      ? { bankName: row.bankName, bankCode: row.bankCode, bankAccountLast4: row.accountLast4, bankAccountName: row.accountName, bankNameMatch: true }
      : { bankNameMatch: false }).where(eq(users.id, input.userId));
    await tx.insert(auditLogs).values({ actorUserId: input.reviewerUserId, action: input.approve ? "payout.destination_approved" : "payout.destination_rejected", entityType: "payout_destination", entityId: String(input.userId), metadataJson: { accountLast4: row.accountLast4, version: row.version } });
    return { userId: input.userId, nameCheck, accountName: row.accountName };
  });
}

/** Internal dispatch-only resolver. The returned NUBAN must never enter logs, receipts or API responses. */
export async function resolvePayoutDestination(userId: number, client: IdentityClient = getDb()): Promise<PayoutDestinationInput> {
  const [row] = await client.select().from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
  if (!row) throw new Error("No encrypted payout destination is configured");
  if (!USABLE_CHECKS.includes(row.nameCheck)) throw new Error(row.nameCheck === "review" ? "The payout account is waiting for Operations to confirm the name" : "The payout account hasn't passed the bank name check");
  return {
    accountNumber: decryptPayoutAccountNumber(userId, row),
    bankCode: row.bankCode,
    accountName: row.accountName,
  };
}
