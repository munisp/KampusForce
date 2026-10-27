import { and, eq } from "drizzle-orm";
import { attributionRecords, consentLogs, products, reps } from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPhone, signedToken } from "./security";

const TOKEN_SECRET = process.env.ATTRIBUTION_SECRET || "kampusforce-sandbox-attribution-secret";

export function attributionToken(repId: number, productId: number, vendorId: number) {
  return signedToken(JSON.stringify({ repId, productId, vendorId, exp: Date.now() + 30 * 86_400_000 }), TOKEN_SECRET);
}

export async function ensureAttribution(input: { repId: number; productId: number; customerPhone: string; source: "link" | "qr" | "assisted" | "claim"; actorUserId?: number }) {
  const db = getDb();
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("Product not found");
  const phoneHash = hashPhone(input.customerPhone);
  const [existing] = await db.select().from(attributionRecords).where(and(eq(attributionRecords.customerPhoneHash, phoneHash), eq(attributionRecords.vendorId, product.vendorId))).limit(1);
  if (existing) return { attribution: existing, created: false, phoneHash };
  const token = attributionToken(input.repId, product.id, product.vendorId);
  const [{ id }] = await db.insert(attributionRecords).values({ repId: input.repId, customerPhoneHash: phoneHash, productId: product.id, vendorId: product.vendorId, source: input.source, tokenSig: token.slice(-48), claimExpiresAt: new Date(Date.now() + 24 * 3_600_000) }).$returningId();
  await db.insert(consentLogs).values({ actorUserId: input.actorUserId, phoneHash, purpose: "Attribution and vendor-assisted onboarding", policyVersion: "privacy-v1.0" });
  const [attribution] = await db.select().from(attributionRecords).where(eq(attributionRecords.id, id)).limit(1);
  return { attribution, created: true, phoneHash };
}

export async function repByCode(code: string) {
  const [rep] = await getDb().select().from(reps).where(eq(reps.code, code)).limit(1);
  return rep;
}
