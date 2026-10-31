import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, payoutDestinations, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { assertCurrentIdentityApproval, type IdentityClient } from "./identity";

export type PayoutDestinationInput = {
  accountNumber: string;
  bankCode: string;
  accountName: string;
};

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-NG");
}

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

export async function configurePayoutDestination(userId: number, input: PayoutDestinationInput) {
  const destination = validatePayoutDestination(input);
  return getDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    if (!user || user.role !== "rep") throw new TRPCError({ code: "NOT_FOUND", message: "Representative profile not found" });
    await assertCurrentIdentityApproval({ subjectType: "user", subjectId: userId, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, tx);
    if (user.kycState !== "verified" || !user.bankNameMatch || !user.bankAccountName || normalizedName(user.bankAccountName) !== normalizedName(destination.accountName)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The destination account name must match the independently verified bank-name record" });
    }
    const encrypted = encryptPayoutAccountNumber(userId, destination.accountNumber);
    const [existing] = await tx.select().from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
    const values = {
      ...encrypted,
      bankCode: destination.bankCode,
      accountName: destination.accountName,
      accountLast4: destination.accountNumber.slice(-4),
      updatedAt: new Date(),
    };
    if (existing) {
      await tx.update(payoutDestinations).set({ ...values, version: existing.version + 1 }).where(eq(payoutDestinations.userId, userId));
    } else {
      await tx.insert(payoutDestinations).values({ userId, ...values });
    }
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: existing ? "payout.destination_replaced" : "payout.destination_configured",
      entityType: "payout_destination",
      entityId: String(userId),
      metadataJson: { bankCode: destination.bankCode, accountLast4: destination.accountNumber.slice(-4), encryptedAtRest: true, fullAccountNumberPersisted: false, identityNameMatched: true },
    });
    return { configured: true as const, bankCode: destination.bankCode, accountName: destination.accountName, accountLast4: destination.accountNumber.slice(-4), version: existing ? existing.version + 1 : 1, fullAccountNumberPersisted: false as const };
  });
}

export async function payoutDestinationStatus(userId: number) {
  const [row] = await getDb().select({
    bankCode: payoutDestinations.bankCode,
    accountName: payoutDestinations.accountName,
    accountLast4: payoutDestinations.accountLast4,
    version: payoutDestinations.version,
    updatedAt: payoutDestinations.updatedAt,
  }).from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
  return row ? { configured: true as const, ...row, fullAccountNumberPersisted: false as const } : { configured: false as const, fullAccountNumberPersisted: false as const };
}

/** Internal dispatch-only resolver. The returned NUBAN must never enter logs, receipts or API responses. */
export async function resolvePayoutDestination(userId: number, client: IdentityClient = getDb()): Promise<PayoutDestinationInput> {
  const [row] = await client.select().from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
  if (!row) throw new Error("No encrypted payout destination is configured");
  return {
    accountNumber: decryptPayoutAccountNumber(userId, row),
    bankCode: row.bankCode,
    accountName: row.accountName,
  };
}
