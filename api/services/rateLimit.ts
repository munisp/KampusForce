import { createHash } from "node:crypto";
import type { Context, Next } from "hono";
import { sql } from "drizzle-orm";
import { rateLimitBuckets } from "@db/schema";
import { getDb } from "../queries/connection";

export type RateLimitPolicy = "otp_request" | "otp_verify" | "demo_login" | "recruitment_inspect" | "vendor_event" | "vendor_connector_progress" | "provider_payout_webhook";

type RateLimitOptions = {
  policy: RateLimitPolicy;
  limit: number;
  windowSeconds: number;
  subject: (c: Context) => string;
};

export function rateLimitWindowStart(date: Date, windowSeconds: number) {
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error("Rate-limit window must be positive");
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(date.getTime() / windowMs) * windowMs);
}

export function rateLimitSubjectHash(policy: RateLimitPolicy, subject: string, windowStart: Date) {
  return createHash("sha256").update(`kf-rate-limit:v1:${policy}:${subject}:${windowStart.toISOString()}`).digest("hex");
}

export function requestSubject(c: Context) {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0].trim();
  const real = c.req.header("x-real-ip")?.trim();
  const bindings = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return forwarded || real || bindings?.incoming?.socket?.remoteAddress || "local";
}

export async function consumeRateLimit(options: {
  policy: RateLimitPolicy;
  subject: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
}) {
  const { policy, subject, limit, windowSeconds } = options;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("Rate-limit count must be positive");
  const now = options.now || new Date();
  const windowStartedAt = rateLimitWindowStart(now, windowSeconds);
  const expiresAt = new Date(windowStartedAt.getTime() + windowSeconds * 1000);
  const keyHash = rateLimitSubjectHash(policy, subject, windowStartedAt);
  const [bucket] = await getDb().insert(rateLimitBuckets).values({
    keyHash,
    policy,
    windowStartedAt,
    requestCount: 1,
    expiresAt,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: rateLimitBuckets.keyHash,
    set: {
      requestCount: sql`${rateLimitBuckets.requestCount} + 1`,
      updatedAt: now,
    },
  }).returning({ requestCount: rateLimitBuckets.requestCount });
  const requestCount = bucket?.requestCount || 1;
  return {
    allowed: requestCount <= limit,
    requestCount,
    remaining: Math.max(0, limit - requestCount),
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

export function rateLimit(options: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    const result = await consumeRateLimit({
      policy: options.policy,
      subject: options.subject(c),
      limit: options.limit,
      windowSeconds: options.windowSeconds,
    });
    c.header("X-RateLimit-Limit", String(options.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json({ error: "Rate limit exceeded", retryAfterSeconds: result.retryAfterSeconds }, 429);
    }
    await next();
  };
}

export const ipRateLimit = (policy: RateLimitPolicy, limit: number, windowSeconds: number) =>
  rateLimit({ policy, limit, windowSeconds, subject: requestSubject });
