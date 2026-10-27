import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs, vendorWebhookCredentials, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { hmacSha256, safeSignatureEqual } from "./security";
import { credentialAcceptsAt, WEBHOOK_CREDENTIAL_GRACE_MS } from "./ingestionPolicy";

export async function verifyVendorWebhookCredential(vendorId: number, raw: string, signature: string, now = new Date()) {
  const credentials = await getDb().select().from(vendorWebhookCredentials).where(eq(vendorWebhookCredentials.vendorId, vendorId));
  for (const credential of credentials) {
    if (!credentialAcceptsAt(credential.state, credential.expiresAt, now)) continue;
    if (safeSignatureEqual(signature, hmacSha256(raw, credential.secret))) return credential;
  }
  return null;
}

export async function activeWebhookCredential(vendorId: number) {
  const [credential] = await getDb().select().from(vendorWebhookCredentials)
    .where(and(eq(vendorWebhookCredentials.vendorId, vendorId), eq(vendorWebhookCredentials.state, "active")))
    .orderBy(desc(vendorWebhookCredentials.keyVersion)).limit(1);
  return credential || null;
}

export async function rotateVendorWebhookCredential(actorUserId: number, vendorId: number) {
  return getDb().transaction(async (tx) => {
    const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1).for("update");
    if (!vendor || vendor.status !== "active") throw new Error("Unknown or inactive vendor");
    const credentials = await tx.select().from(vendorWebhookCredentials)
      .where(eq(vendorWebhookCredentials.vendorId, vendorId)).orderBy(desc(vendorWebhookCredentials.keyVersion)).for("update");
    const now = new Date();
    const graceExpiresAt = new Date(now.getTime() + WEBHOOK_CREDENTIAL_GRACE_MS);
    for (const credential of credentials) {
      if (credential.state === "active") {
        await tx.update(vendorWebhookCredentials).set({ state: "retiring", expiresAt: graceExpiresAt }).where(eq(vendorWebhookCredentials.id, credential.id));
      } else if (credential.state === "retiring") {
        await tx.update(vendorWebhookCredentials).set({ state: "revoked", revokedAt: now }).where(eq(vendorWebhookCredentials.id, credential.id));
      }
    }
    const keyVersion = (credentials[0]?.keyVersion || 0) + 1;
    const secret = randomBytes(48).toString("hex");
    const [credential] = await tx.insert(vendorWebhookCredentials).values({ vendorId, keyVersion, secret, state: "active" }).returning();
    await tx.update(vendors).set({ webhookSecret: secret }).where(eq(vendors.id, vendorId));
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "vendor.webhook_credential.rotated",
      entityType: "vendor",
      entityId: String(vendorId),
      metadataJson: { keyVersion, previousCredentialExpiresAt: graceExpiresAt, graceMinutes: WEBHOOK_CREDENTIAL_GRACE_MS / 60_000 },
    });
    return { keyVersion, secret, previousCredentialExpiresAt: graceExpiresAt, credentialId: credential.id };
  });
}
