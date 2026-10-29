import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { vendorOnboardingConnectors, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { ingestWithDurableRetry } from "../services/ingestionRetries";
import { verifyVendorWebhookCredential } from "../services/webhookCredentials";
import { recordConnectorProgress } from "../services/vendorConnectors";

const connectorProgressSchema = z.object({
  connector_ref: z.string().min(8).max(64),
  handoff_id: z.number().int().positive(),
  event_id: z.string().min(8).max(160),
  stage: z.enum(["clicked", "registered", "provisioned", "account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]),
  occurred_at: z.string().datetime(),
  customer: z.object({ phone: z.string(), customer_ref: z.string().min(3).max(160) }),
  amount_kobo: z.number().int().positive().optional(),
});

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
  const credential = await verifyVendorWebhookCredential(vendor.id, raw, signature);
  if (!credential) return c.json({ error: "Invalid HMAC signature" }, 401);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return c.json({ error: "Malformed JSON payload" }, 400); }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: "Invalid event payload", issues: parsed.error.issues }, 400);
  const result = await ingestWithDurableRetry(vendorKey, parsed.data, { credentialId: credential.id });
  return c.json(result, result.status === "duplicate" ? 200 : 202);
});

webhookRoutes.post("/:vendorKey/connector-progress", bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
  const vendorKey = c.req.param("vendorKey");
  const [vendor] = await getDb().select().from(vendors).where(eq(vendors.webhookKey, vendorKey)).limit(1);
  if (!vendor) return c.json({ error: "Unknown vendor" }, 404);
  const raw = await c.req.text();
  const signature = c.req.header("X-KF-Signature") || "";
  const timestamp = Number(c.req.header("X-KF-Timestamp"));
  const timestampMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  if (!timestamp || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return c.json({ error: "Timestamp outside five-minute window" }, 401);
  const credential = await verifyVendorWebhookCredential(vendor.id, raw, signature);
  if (!credential) return c.json({ error: "Invalid HMAC signature" }, 401);
  if (!vendor.userId) return c.json({ error: "Connector vendor owner is not configured" }, 409);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return c.json({ error: "Malformed JSON payload" }, 400); }
  const parsed = connectorProgressSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: "Invalid connector progress payload", issues: parsed.error.issues }, 400);
  const [connector] = await getDb().select({ id: vendorOnboardingConnectors.id, vendorId: vendorOnboardingConnectors.vendorId }).from(vendorOnboardingConnectors).where(eq(vendorOnboardingConnectors.connectorRef, parsed.data.connector_ref)).limit(1);
  if (!connector || connector.vendorId !== vendor.id) return c.json({ error: "Connector not found" }, 404);
  const result = await recordConnectorProgress({
    actor: { userId: vendor.userId, role: "vendor", vendorId: vendor.id },
    connectorId: connector.id,
    handoffId: parsed.data.handoff_id,
    externalEventKey: parsed.data.event_id,
    stage: parsed.data.stage,
    externalCustomerRef: parsed.data.customer.customer_ref,
    customerPhone: parsed.data.customer.phone,
    amountKobo: parsed.data.amount_kobo,
    occurredAt: new Date(parsed.data.occurred_at),
    webhookCredentialId: credential.id,
  });
  return c.json(result, result.idempotent ? 200 : 202);
});
