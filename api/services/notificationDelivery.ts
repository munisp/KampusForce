import { createHash, createHmac } from "node:crypto";
import { and, eq, inArray, lt, lte, or } from "drizzle-orm";
import { auditLogs, notificationDeliveries, notifications } from "@db/schema";
import { getDb } from "../queries/connection";
import { assertLiveProviderExecutionAuthorized } from "./launchReadiness";

const MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 2 * 60_000;

export function notificationDeliveryConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const url = (env.KF_NOTIFICATION_WEBHOOK_URL || "").trim();
  const secret = (env.KF_NOTIFICATION_WEBHOOK_SECRET || "").trim();
  const requested = Boolean(url || secret);
  const mode = env.KF_PROVIDER_MODE === "live" ? "live" as const : "sandbox" as const;
  const allowed = (env.KF_NOTIFICATION_ALLOWED_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean);
  let endpointPolicyValid = false;
  if (url) {
    try {
      const endpoint = new URL(url);
      const credentialFree = !endpoint.username && !endpoint.password && !endpoint.hash;
      endpointPolicyValid = credentialFree && (mode === "live"
        ? endpoint.protocol === "https:" && allowed.includes(endpoint.hostname) && env.KF_SANDBOX_MODE === "false" && env.KF_LIVE_CUTOVER_AUTHORIZED === "true"
        : endpoint.protocol === "https:" || (endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)));
    } catch {
      endpointPolicyValid = false;
    }
  }
  const enabled = Boolean(url && secret && secret.length >= 32 && endpointPolicyValid);
  return {
    requested,
    enabled,
    misconfigured: requested && !enabled,
    mode,
    allowedHostsConfigured: allowed.length > 0,
    boundary: "A delivered receipt means the configured webhook accepted a signed notification; it does not prove SMS, email, WhatsApp or user read receipt.",
  };
}

function deliveryEndpoint(env: NodeJS.ProcessEnv) {
  const configuration = notificationDeliveryConfiguration(env);
  if (!configuration.enabled) throw new Error("Signed notification delivery is not configured with a URL and 32+ character secret");
  const url = new URL(env.KF_NOTIFICATION_WEBHOOK_URL || "");
  if (url.username || url.password || url.hash) throw new Error("Notification webhook URL must not contain credentials or fragments");
  if (configuration.mode === "live") {
    const allowed = (env.KF_NOTIFICATION_ALLOWED_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean);
    if (url.protocol !== "https:" || !allowed.includes(url.hostname)) throw new Error("Live notification delivery requires HTTPS and an explicitly allowlisted host");
    if (env.KF_SANDBOX_MODE !== "false" || env.KF_LIVE_CUTOVER_AUTHORIZED !== "true") throw new Error("Live notification delivery requires production mode and explicit cutover authorization");
  } else {
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Sandbox notification delivery requires HTTPS or a loopback HTTP endpoint");
  }
  return url;
}

function retryAt(attempts: number) {
  return new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000);
}

async function finishDelivery(input: {
  deliveryId: number;
  notificationId: number;
  state: "delivered" | "retry_scheduled" | "dead_letter";
  attempts: number;
  error?: string;
  receiptHash?: string;
}) {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.update(notificationDeliveries).set({
      state: input.state,
      availableAt: input.state === "retry_scheduled" ? retryAt(input.attempts) : now,
      lastError: input.error?.slice(0, 120) || null,
      receiptHash: input.receiptHash || null,
      deliveredAt: input.state === "delivered" ? now : null,
      updatedAt: now,
    }).where(eq(notificationDeliveries.id, input.deliveryId));
    if (input.state !== "retry_scheduled") {
      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: `notification.delivery_${input.state}`,
        entityType: "notification",
        entityId: String(input.notificationId),
        metadataJson: { deliveryId: input.deliveryId, attempts: input.attempts, channel: "signed_webhook", externalChannelReadReceipt: false, error: input.error?.slice(0, 120) || null },
      });
    }
  });
}

export async function processDueNotificationDeliveries(request: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env) {
  const configuration = notificationDeliveryConfiguration(env);
  if (!configuration.enabled) return { claimed: 0, delivered: 0, retryScheduled: 0, deadLetter: 0, blocked: configuration.misconfigured ? "misconfigured" as const : "disabled" as const };
  const url = deliveryEndpoint(env);
  if (configuration.mode === "live") await assertLiveProviderExecutionAuthorized();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
  const due = await getDb().select({ id: notificationDeliveries.id }).from(notificationDeliveries).where(and(
    lt(notificationDeliveries.attempts, MAX_ATTEMPTS),
    or(
      and(inArray(notificationDeliveries.state, ["queued", "retry_scheduled"]), lte(notificationDeliveries.availableAt, now)),
      and(eq(notificationDeliveries.state, "processing"), lt(notificationDeliveries.updatedAt, staleBefore)),
    ),
  )).orderBy(notificationDeliveries.createdAt).limit(50);
  let claimedCount = 0;
  let delivered = 0;
  let retryScheduled = 0;
  let deadLetter = 0;
  for (const candidate of due) {
    const claimed = await getDb().transaction(async (tx) => {
      const [row] = await tx.select({ delivery: notificationDeliveries, notification: notifications }).from(notificationDeliveries)
        .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
        .where(eq(notificationDeliveries.id, candidate.id)).limit(1).for("update", { skipLocked: true });
      if (!row || row.delivery.attempts >= MAX_ATTEMPTS || row.delivery.state === "delivered" || row.delivery.state === "dead_letter") return null;
      const claimTime = new Date();
      const claimable = (["queued", "retry_scheduled"].includes(row.delivery.state) && row.delivery.availableAt <= claimTime)
        || (row.delivery.state === "processing" && row.delivery.updatedAt < new Date(claimTime.getTime() - PROCESSING_TIMEOUT_MS));
      if (!claimable) return null;
      const attempts = row.delivery.attempts + 1;
      await tx.update(notificationDeliveries).set({ state: "processing", attempts, lastError: null, updatedAt: new Date() }).where(eq(notificationDeliveries.id, row.delivery.id));
      return { ...row, attempts };
    });
    if (!claimed) continue;
    claimedCount += 1;
    const deliveryId = String(claimed.delivery.id);
    const timestamp = String(Date.now());
    const payload = JSON.stringify({
      schema_version: "kampusforce-notification-v1",
      delivery_id: deliveryId,
      notification_id: claimed.notification.id,
      recipient_user_id: claimed.notification.userId,
      type: claimed.notification.type,
      title: claimed.notification.title,
      body: claimed.notification.body,
      href: claimed.notification.href,
      entity_type: claimed.notification.entityType,
      entity_id: claimed.notification.entityId,
      created_at: claimed.notification.createdAt.toISOString(),
    });
    const signature = createHmac("sha256", env.KF_NOTIFICATION_WEBHOOK_SECRET || "").update(`${timestamp}.${payload}`).digest("hex");
    try {
      const response = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-kf-timestamp": timestamp, "x-kf-signature": signature, "x-kf-delivery-id": deliveryId },
        body: payload,
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      const providerReceipt = response.headers.get("x-receipt-id") || response.headers.get("request-id") || "";
      try { await response.body?.cancel(); } catch { /* Receipt headers are sufficient; response bodies are never retained. */ }
      const receiptHash = createHash("sha256").update(`${deliveryId}:${response.status}:${providerReceipt.slice(0, 160)}`).digest("hex");
      if (response.ok) {
        await finishDelivery({ deliveryId: claimed.delivery.id, notificationId: claimed.notification.id, state: "delivered", attempts: claimed.attempts, receiptHash });
        delivered += 1;
      } else {
        const retryable = response.status >= 500 || [408, 429].includes(response.status);
        const exhausted = claimed.attempts >= MAX_ATTEMPTS;
        const state = retryable && !exhausted ? "retry_scheduled" as const : "dead_letter" as const;
        await finishDelivery({ deliveryId: claimed.delivery.id, notificationId: claimed.notification.id, state, attempts: claimed.attempts, error: `webhook_http_${response.status}`, receiptHash });
        if (state === "dead_letter") deadLetter += 1; else retryScheduled += 1;
      }
    } catch {
      const exhausted = claimed.attempts >= MAX_ATTEMPTS;
      const state = exhausted ? "dead_letter" as const : "retry_scheduled" as const;
      await finishDelivery({ deliveryId: claimed.delivery.id, notificationId: claimed.notification.id, state, attempts: claimed.attempts, error: "webhook_request_failed" });
      if (state === "dead_letter") deadLetter += 1; else retryScheduled += 1;
    }
  }
  return { claimed: claimedCount, delivered, retryScheduled, deadLetter };
}
