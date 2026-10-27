import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { ingestVendorEvent } from "../services/events";
import { hmacSha256, safeSignatureEqual } from "../services/security";

const eventSchema = z.object({
  event_id: z.string().min(8).max(160),
  type: z.enum(["account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]),
  occurred_at: z.string().datetime(),
  customer: z.object({ phone: z.string(), customer_ref: z.string().optional() }),
  product_ref: z.string(),
  amount_kobo: z.number().int().positive().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const webhookRoutes = new Hono();
webhookRoutes.post("/:vendorKey/events", bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
  const vendorKey = c.req.param("vendorKey");
  const [vendor] = await getDb().select().from(vendors).where(eq(vendors.webhookKey, vendorKey)).limit(1);
  if (!vendor) return c.json({ error: "Unknown vendor" }, 404);
  const raw = await c.req.text();
  const signature = c.req.header("X-KF-Signature") || "";
  const timestamp = Number(c.req.header("X-KF-Timestamp"));
  const timestampMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  if (!timestamp || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return c.json({ error: "Timestamp outside five-minute window" }, 401);
  if (!safeSignatureEqual(signature, hmacSha256(raw, vendor.webhookSecret))) return c.json({ error: "Invalid HMAC signature" }, 401);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return c.json({ error: "Malformed JSON payload" }, 400); }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: "Invalid event payload", issues: parsed.error.issues }, 400);
  const result = await ingestVendorEvent(vendorKey, parsed.data);
  return c.json(result, result.status === "duplicate" ? 200 : 202);
});
