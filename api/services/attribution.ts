import { and, eq } from "drizzle-orm";
import { attributionRecords, consentLogs, products, reps } from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPhone, signedToken, verifySignedToken } from "./security";
import "../lib/env";

const TOKEN_SECRET = process.env.ATTRIBUTION_SECRET || "kampusforce-sandbox-attribution-secret";

export function attributionToken(repId: number, productId: number, vendorId: number) {
  return signedToken(JSON.stringify({ repId, productId, vendorId, exp: Date.now() + 30 * 86_400_000 }), TOKEN_SECRET);
}

export function resolveAttributionToken(token: string, expected: { productId: number; vendorId: number }) {
  try {
    const payload = JSON.parse(verifySignedToken(token, TOKEN_SECRET) || "null") as { repId?: number; productId?: number; vendorId?: number; exp?: number } | null;
    if (!payload || !Number.isInteger(payload.repId) || payload.productId !== expected.productId || payload.vendorId !== expected.vendorId || !payload.exp || payload.exp <= Date.now()) return null;
    return { repId: payload.repId as number, productId: payload.productId, vendorId: payload.vendorId };
  } catch {
    return null;
  }
}

export async function ensureAttribution(input: { repId: number; productId: number; customerPhone: string; source: "link" | "qr" | "assisted" | "claim"; actorUserId?: number }) {
  const db = getDb();
  const phoneHash = hashPhone(input.customerPhone);
  return db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.status, "active"))).limit(1);
    if (!product) throw new Error("Active product not found");
    const [rep] = await tx.select({ id: reps.id }).from(reps).where(and(eq(reps.id, input.repId), eq(reps.status, "active"))).limit(1);
    if (!rep) throw new Error("Active representative not found");

    const whereFirstTouch = and(eq(attributionRecords.customerPhoneHash, phoneHash), eq(attributionRecords.vendorId, product.vendorId));
    const [existing] = await tx.select().from(attributionRecords).where(whereFirstTouch).limit(1);
    if (existing) return { attribution: existing, created: false, phoneHash };

    const token = attributionToken(input.repId, product.id, product.vendorId);
    const inserted = await tx.insert(attributionRecords).values({
      repId: input.repId,
      customerPhoneHash: phoneHash,
      productId: product.id,
      vendorId: product.vendorId,
      source: input.source,
      tokenSig: token.slice(-48),
      claimExpiresAt: new Date(Date.now() + 24 * 3_600_000),
    }).onConflictDoNothing({ target: [attributionRecords.customerPhoneHash, attributionRecords.vendorId] }).returning();

    if (inserted.length) {
      await tx.insert(consentLogs).values({
        actorUserId: input.actorUserId,
        phoneHash,
        purpose: "Attribution and vendor-assisted onboarding",
        policyVersion: "privacy-v1.0",
      });
      return { attribution: inserted[0], created: true, phoneHash };
    }

    const [attribution] = await tx.select().from(attributionRecords).where(whereFirstTouch).limit(1);
    if (!attribution) throw new Error("First-touch attribution could not be resolved");
    return { attribution, created: false, phoneHash };
  });
}

export async function repByCode(code: string) {
  const [rep] = await getDb().select().from(reps).where(eq(reps.code, code)).limit(1);
  return rep;
}
