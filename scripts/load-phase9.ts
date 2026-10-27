import "dotenv/config";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { randomBytes, randomInt } from "node:crypto";
import { getDb } from "../api/queries/connection";
import { campuses, commissionRules, products, reps, users, vendorWebhookCredentials, vendors } from "../db/schema";
import { ensureAttribution } from "../api/services/attribution";
import { hmacSha256 } from "../api/services/security";

const baseUrl = process.env.KF_LOAD_BASE_URL || "http://127.0.0.1:3000";
const eventCount = Number(process.env.KF_LOAD_EVENTS || 100);
const concurrency = Number(process.env.KF_LOAD_CONCURRENCY || 25);
assert.ok(Number.isInteger(eventCount) && eventCount >= 1 && eventCount <= 100);
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 50);

async function main() {
  const db = getDb();
  const suffix = crypto.randomUUID();
  const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
  assert.ok(campus);
  const secret = randomBytes(48).toString("hex");
  const [vendor] = await db.insert(vendors).values({
    companyName: "Phase Nine Load Vendor",
    webhookKey: `phase9-load-${suffix}`,
    webhookSecret: secret,
    status: "active",
  }).returning();
  await db.insert(vendorWebhookCredentials).values({ vendorId: vendor.id, keyVersion: 1, secret, state: "active" });
  const [product] = await db.insert(products).values({
    vendorId: vendor.id,
    vendorRef: `phase9-load-${suffix.slice(0, 8)}`,
    name: "Phase Nine Load Product",
    category: "fintech",
    description: "Isolated sandbox HTTP load fixture",
    priceKobo: 500_000,
    landingUrl: "https://example.invalid/phase9-load",
    pitchScript: "Sandbox only",
    status: "active",
  }).returning();
  await db.insert(commissionRules).values({ productId: product.id, version: 1, basis: "flat", flatAmountKobo: 100_000, triggerEvent: "funded", confirmDays: 30, clawbackDays: 60, activationCapPerRepDay: 1000 });
  const [user] = await db.insert(users).values({
    phoneE164: `+23492${String(randomInt(10000000, 99999999))}`,
    name: "Phase Nine Load Rep",
    role: "rep",
    kycState: "verified",
    bankNameMatch: true,
  }).returning();
  const [rep] = await db.insert(reps).values({ userId: user.id, campusId: campus.id, code: `P9L-${suffix.slice(0, 8)}`, status: "active" }).returning();
  const phones = Array.from({ length: eventCount }, (_, index) => `+23493${String(10000000 + randomInt(0, 80000000) + index).slice(-8)}`);
  const uniquePhones = [...new Set(phones)];
  assert.equal(uniquePhones.length, phones.length, "Load fixture phone collision");
  for (const customerPhone of uniquePhones) {
    await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone, source: "link", actorUserId: user.id });
  }

  const bodies = uniquePhones.map((customerPhone, index) => JSON.stringify({
    event_id: `${suffix}-${index}`,
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: customerPhone, customer_ref: `phase9-load-${index}` },
    product_ref: product.vendorRef,
    amount_kobo: 500_000,
    meta: { channel: "phase9_http_load" },
  }));
  const latencies: number[] = [];
  const outcomes: { status: number; result: string }[] = [];
  let cursor = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < bodies.length) {
      const index = cursor++;
      const raw = bodies[index];
      const requestStarted = performance.now();
      const response = await fetch(`${baseUrl}/v1/webhooks/${vendor.webhookKey}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-KF-Timestamp": String(Math.floor(Date.now() / 1000)),
          "X-KF-Signature": hmacSha256(raw, secret),
        },
        body: raw,
      });
      const responseText = await response.text();
      latencies.push(performance.now() - requestStarted);
      if (!responseText) {
        throw new Error(`Webhook returned HTTP ${response.status} with an empty response body`);
      }
      let result: { status?: string };
      try {
        result = JSON.parse(responseText) as { status?: string };
      } catch {
        throw new Error(`Webhook returned HTTP ${response.status} with a non-JSON body: ${responseText.slice(0, 200)}`);
      }
      outcomes.push({ status: response.status, result: result.status || "error" });
    }
  }));
  const elapsedMs = performance.now() - started;
  const accepted = outcomes.filter((outcome) => outcome.status === 202 && outcome.result === "accepted").length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const throughput = accepted / (elapsedMs / 1000);
  const report = {
    status: accepted === eventCount && throughput >= 50 ? "passed" : "failed",
    mode: "local_sandbox_http",
    events: eventCount,
    concurrency,
    accepted,
    httpOutcomes: outcomes.reduce<Record<string, number>>((counts, outcome) => {
      const key = `${outcome.status}:${outcome.result}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    elapsedMs: Math.round(elapsedMs),
    acceptedPerSecond: Number(throughput.toFixed(2)),
    targetEventsPerSecond: 50,
    latencyMs: { p50: Math.round(percentile(0.5)), p95: Math.round(percentile(0.95)), p99: Math.round(percentile(0.99)) },
    boundary: "Local sandbox measurement; not staging, production or provider-capacity certification.",
  };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(accepted, eventCount);
  assert.ok(throughput >= 50, `50 events/second target missed: ${throughput.toFixed(2)}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
