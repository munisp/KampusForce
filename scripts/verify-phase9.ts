import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  auditLogs,
  campuses,
  commissionRules,
  deals,
  ledgerEntries,
  products,
  reps,
  users,
  vendorEvents,
  vendorIngestionRetries,
  vendorWebhookCredentials,
  vendors,
} from "../db/schema";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent, type VendorEventInput } from "../api/services/events";
import { hmacSha256 } from "../api/services/security";
import {
  ingestWithDurableRetry,
  processDueIngestionRetries,
  scheduleIngestionRetry,
} from "../api/services/ingestionRetries";
import { rotateVendorWebhookCredential, verifyVendorWebhookCredential } from "../api/services/webhookCredentials";
import { runDurableJob } from "../api/services/jobs";

const db = getDb();
const suffix = crypto.randomUUID();
const phone = () => `+23491${String(randomInt(10000000, 99999999))}`;

function event(productRef: string, customerPhone: string, id: string): VendorEventInput {
  return {
    event_id: id,
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: customerPhone, customer_ref: `phase9-${id}` },
    product_ref: productRef,
    amount_kobo: 500_000,
    meta: { channel: "phase9_acceptance" },
  };
}

async function financialSnapshot(repId: number) {
  const dealRows = await db.select().from(deals).where(eq(deals.repId, repId)).orderBy(deals.id);
  const dealIds = dealRows.map((deal) => deal.id);
  const ledgerRows = dealIds.length ? await db.select().from(ledgerEntries).where(inArray(ledgerEntries.dealId, dealIds)).orderBy(ledgerEntries.id) : [];
  return JSON.stringify({ dealRows, ledgerRows });
}

async function makeDue(retryId: string) {
  await db.update(vendorIngestionRetries).set({ nextRetryAt: new Date(Date.now() - 1000) }).where(eq(vendorIngestionRetries.id, retryId));
}

async function main() {
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
  assert.ok(vendor?.userId && campus);
  const [user] = await db.insert(users).values({
    phoneE164: phone(),
    name: "Phase Nine Reliability Rep",
    role: "rep",
    kycState: "verified",
    bankNameMatch: true,
  }).returning();
  const [rep] = await db.insert(reps).values({ userId: user.id, campusId: campus.id, code: `P9-${suffix.slice(0, 8)}`, status: "active" }).returning();
  const [product] = await db.insert(products).values({
    vendorId: vendor.id,
    vendorRef: `phase9-reliability-${suffix.slice(0, 8)}`,
    name: "Phase Nine Reliability Product",
    category: "fintech",
    description: "Sandbox retry, retention and credential fixture",
    priceKobo: 500_000,
    landingUrl: "https://example.invalid/phase9",
    pitchScript: "Sandbox only",
    status: "active",
  }).returning();
  await db.insert(commissionRules).values({ productId: product.id, version: 1, basis: "flat", flatAmountKobo: 100_000, triggerEvent: "funded", confirmDays: 30, clawbackDays: 60, activationCapPerRepDay: 1000 });

  const beforeRotation = await financialSnapshot(rep.id);
  const oldSecret = vendor.webhookSecret;
  const rotation = await rotateVendorWebhookCredential(vendor.userId!, vendor.id);
  assert.notEqual(rotation.secret, oldSecret);
  assert.equal(rotation.keyVersion >= 2, true);
  const oldCredential = await verifyVendorWebhookCredential(vendor.id, "phase9-body", hmacSha256("phase9-body", oldSecret));
  const newCredential = await verifyVendorWebhookCredential(vendor.id, "phase9-body", hmacSha256("phase9-body", rotation.secret));
  assert.equal(oldCredential?.state, "retiring");
  assert.equal(newCredential?.id, rotation.credentialId);
  await db.update(vendorWebhookCredentials).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(vendorWebhookCredentials.id, oldCredential!.id));
  assert.equal(await verifyVendorWebhookCredential(vendor.id, "phase9-body", hmacSha256("phase9-body", oldSecret)), null);
  const rotationAudits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "vendor"), eq(auditLogs.entityId, String(vendor.id)), eq(auditLogs.action, "vendor.webhook_credential.rotated")));
  const auditText = JSON.stringify(rotationAudits);
  assert.ok(!auditText.includes(oldSecret) && !auditText.includes(rotation.secret));
  assert.equal(await financialSnapshot(rep.id), beforeRotation);

  const retryPhone = phone();
  await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: retryPhone, source: "link", actorUserId: user.id });
  const retryEvent = event(product.vendorRef, retryPhone, `${suffix}-retry`);
  const scheduled = await scheduleIngestionRetry(vendor.webhookKey, retryEvent, "40P01", { credentialId: rotation.credentialId });
  assert.equal((await processDueIngestionRetries()).resolved, 0);
  await makeDue(scheduled.retryId);
  const transientFailure = async () => { throw Object.assign(new Error("sandbox deadlock"), { code: "40P01" }); };
  const firstRetry = await processDueIngestionRetries(new Date(), transientFailure);
  assert.equal(firstRetry.retryScheduled, 1);
  const [afterFirstRetry] = await db.select().from(vendorIngestionRetries).where(eq(vendorIngestionRetries.id, scheduled.retryId));
  assert.equal(afterFirstRetry.attemptCount, 1);
  assert.equal(afterFirstRetry.state, "retry_scheduled");
  assert.ok(!JSON.stringify(afterFirstRetry.payloadJson).includes(retryPhone));
  await makeDue(scheduled.retryId);
  const recovered = await processDueIngestionRetries();
  assert.equal(recovered.resolved, 1);
  const [resolvedRetry] = await db.select().from(vendorIngestionRetries).where(eq(vendorIngestionRetries.id, scheduled.retryId));
  assert.equal(resolvedRetry.state, "resolved");
  assert.ok(resolvedRetry.vendorEventId);
  assert.equal((await ingestWithDurableRetry(vendor.webhookKey, retryEvent)).status, "duplicate");

  const deadPhone = phone();
  await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: deadPhone, source: "link", actorUserId: user.id });
  const deadEvent = event(product.vendorRef, deadPhone, `${suffix}-dead`);
  const deadScheduled = await scheduleIngestionRetry(vendor.webhookKey, deadEvent, "ECONNRESET");
  await makeDue(deadScheduled.retryId);
  const permanentFailure = async () => { throw new Error("Deterministic sandbox failure"); };
  const deadResult = await processDueIngestionRetries(new Date(), permanentFailure);
  assert.equal(deadResult.deadLetter, 1);
  assert.equal((await ingestWithDurableRetry(vendor.webhookKey, deadEvent)).status, "dead_letter");
  assert.equal((await db.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, `${vendor.id}:${deadEvent.event_id}`))).length, 0);

  const concurrentPhone = phone();
  await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: concurrentPhone, source: "link", actorUserId: user.id });
  const concurrentEvent = event(product.vendorRef, concurrentPhone, `${suffix}-concurrent`);
  const concurrentScheduled = await scheduleIngestionRetry(vendor.webhookKey, concurrentEvent, "ECONNRESET");
  await makeDue(concurrentScheduled.retryId);
  const concurrentRuns = await Promise.all([processDueIngestionRetries(), processDueIngestionRetries()]);
  assert.equal(concurrentRuns.reduce((sum, run) => sum + run.resolved, 0), 1);
  assert.equal((await db.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, `${vendor.id}:${concurrentEvent.event_id}`))).length, 1);

  const [retainedEvent] = await db.select().from(vendorEvents).where(eq(vendorEvents.id, resolvedRetry.vendorEventId!)).limit(1);
  const beforePurge = await financialSnapshot(rep.id);
  await db.update(vendorEvents).set({ payloadRetainUntil: new Date(Date.now() - 1000) }).where(eq(vendorEvents.id, retainedEvent.id));
  const retentionJob = await runDurableJob("event_retention", "manual", `phase9-retention-${suffix}`);
  assert.equal(retentionJob.status, "succeeded");
  assert.ok((retentionJob.result as { purged: number }).purged >= 1);
  const [purgedEvent] = await db.select().from(vendorEvents).where(eq(vendorEvents.id, retainedEvent.id)).limit(1);
  assert.equal(purgedEvent.dedupeKey, retainedEvent.dedupeKey);
  assert.ok(purgedEvent.payloadPurgedAt);
  assert.deepEqual(purgedEvent.payloadJson, { retention: "purged", payloadPurged: true });
  assert.equal(await financialSnapshot(rep.id), beforePurge);
  assert.equal((await ingestVendorEvent(vendor.webhookKey, retryEvent)).status, "duplicate");
  assert.equal((await db.select().from(vendorEvents).where(eq(vendorEvents.dedupeKey, retainedEvent.dedupeKey))).length, 1);

  console.log(JSON.stringify({
    status: "passed",
    mode: "sandbox_records",
    credentialRotation: { version: rotation.keyVersion, overlapVerified: true, expiryVerified: true, secretsExcludedFromAudit: true },
    retries: { transientRecovery: true, deadLetter: true, concurrentWorkersResolved: 1, maxAttempts: 3 },
    retention: { payloadPurged: true, dedupeRetained: true, replayRemainsDuplicate: true, financialSnapshotUnchanged: true },
    references: { resolvedRetryId: scheduled.retryId, deadLetterRetryId: deadScheduled.retryId, purgedEventId: purgedEvent.id },
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
