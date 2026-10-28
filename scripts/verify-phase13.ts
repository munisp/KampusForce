import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { analyticsSnapshots, datasetLineage, deals, ledgerEntries, payouts, users } from "../db/schema";
import { getDb } from "../api/queries/connection";
import { buildAdvancedAnalytics, captureAnalyticsSnapshot } from "../api/services/advancedAnalytics";
import { architectureReadiness } from "../api/services/architectureReadiness";
import { dispatchFinancialOutbox, isTerminalTigerBeetleError, reconcileTigerBeetleShadow } from "../api/services/tigerBeetle";
import { createMojaloopPreflightIntent, validateMojaloopSettlementEvidence } from "../api/services/mojaloop";

const db = getDb();

async function main() {
  delete process.env.KF_TIGERBEETLE_ADDRESSES;
  delete process.env.KF_TIGERBEETLE_CLUSTER_ID;
  delete process.env.KF_ALLOW_LIVE_FINANCIAL_EXECUTION;
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  assert.ok(ops, "Seeded Operations user is required");
  const [financialBefore, ledgerBefore] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);

  const analytics = await buildAdvancedAnalytics(365);
  assert.ok(Array.isArray(analytics.dailyTrend));
  assert.ok(Array.isArray(analytics.conversionCohorts));
  assert.ok(analytics.definitions.dailyTrend.includes("separate event-time series"));
  assert.ok(analytics.definitions.conversionCohorts.includes("complete seven-day"));
  assert.ok(!JSON.stringify(analytics).includes("customerPhoneHash"));
  const snapshot = await captureAnalyticsSnapshot(365, ops.id);
  assert.match(snapshot.payloadHash, /^[a-f0-9]{64}$/);
  const [storedSnapshot] = await db.select().from(analyticsSnapshots).where(eq(analyticsSnapshots.snapshotRef, snapshot.snapshotRef)).limit(1);
  assert.equal(storedSnapshot.payloadHash, snapshot.payloadHash);
  await assert.rejects(() => db.update(analyticsSnapshots).set({ payloadHash: "0".repeat(64) }).where(eq(analyticsSnapshots.id, storedSnapshot.id)));
  await assert.rejects(() => db.delete(analyticsSnapshots).where(eq(analyticsSnapshots.id, storedSnapshot.id)));

  const readiness = await architectureReadiness();
  assert.equal(readiness.lakehouse.localReferenceVerified, true, "Record the passing local Delta manifest before this journey");
  assert.equal(readiness.ray.localReferenceVerified, true, "Record the passing local Ray manifest before this journey");
  assert.equal(readiness.ray.modelEvidence?.approved, false);
  assert.equal(readiness.ray.modelEvidence?.baselineAuc, 0.5);
  assert.ok(readiness.ray.modelEvidence?.temporalTestStart);
  assert.equal(readiness.lakehouse.productionReady, false);
  assert.equal(readiness.ray.productionReady, false);
  assert.equal(readiness.tigerbeetle.productionReady, false);
  assert.equal(readiness.mojaloop.productionReady, false);
  assert.equal(readiness.mojaloop.launchDependency, false);
  const [lineage] = await db.select().from(datasetLineage).orderBy(datasetLineage.id).limit(1);
  assert.ok(lineage);
  await assert.rejects(() => db.update(datasetLineage).set({ transform: "must not rewrite lineage" }).where(eq(datasetLineage.id, lineage.id)));

  const dispatch = await dispatchFinancialOutbox(10);
  assert.equal(dispatch.blocked, true);
  assert.equal(dispatch.dispatched, 0);
  const reconciliation = await reconcileTigerBeetleShadow();
  assert.equal(reconciliation.blocked, true);
  assert.equal(reconciliation.reconciled, 0);
  assert.equal(isTerminalTigerBeetleError("TigerBeetle contains only part of a linked outbox group"), true);
  assert.equal(isTerminalTigerBeetleError("connection timeout"), false);

  await assert.rejects(() => createMojaloopPreflightIntent({ payoutId: 1, partyRefHash: "raw-bank-account", actorUserId: ops.id }), /SHA-256/);
  const [queuedPayout] = await db.select().from(payouts).where(eq(payouts.state, "queued")).limit(1);
  let preflightVerified = false;
  if (queuedPayout) {
    const partyRefHash = createHash("sha256").update(`synthetic-party-reference:${queuedPayout.id}`).digest("hex");
    const first = await createMojaloopPreflightIntent({ payoutId: queuedPayout.id, partyRefHash, actorUserId: ops.id });
    const replay = await createMojaloopPreflightIntent({ payoutId: queuedPayout.id, partyRefHash, actorUserId: ops.id });
    assert.equal(first.intent?.intentRef, replay.intent?.intentRef);
    assert.equal(first.externalExecution, false);
    assert.equal(first.settlementEligible, false);
    assert.equal(first.intent?.state, "disabled");
    preflightVerified = true;
  }
  const evidence = { intentRef: "mojo_synthetic", transferRef: "transfer_synthetic", finalSchemeOutcome: "COMMITTED" as const, schemeEvidenceHash: "a".repeat(64), settlementReportHash: "b".repeat(64), independentlyReconciled: true };
  assert.equal(validateMojaloopSettlementEvidence(evidence).settlementEligible, true);
  assert.throws(() => validateMojaloopSettlementEvidence({ ...evidence, finalSchemeOutcome: "RESERVED" }), /final committed/);

  const [financialAfter, ledgerAfter] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);
  assert.deepEqual(financialAfter, financialBefore);
  assert.deepEqual(ledgerAfter, ledgerBefore);
  console.log(JSON.stringify({
    status: "passed",
    mode: "local_sandbox_database_acceptance",
    analytics: { dailyEventTimeTrend: true, sevenDayCohorts: true, immutableHashedSnapshot: true, customerHashesExcluded: true },
    lakehouseRay: { verifiedLocalEvidence: true, temporalHoldoutVisible: true, modelApproved: false, productionReady: false, appendOnlyLineage: true },
    tigerBeetle: { liveDispatchBlocked: true, reconciliationBlocked: true, partialOrConflictingBatchTerminal: true },
    mojaloop: { rawPartyReferenceRejected: true, idempotentPreflight: preflightVerified, externalExecution: false, preparationIsNotSettlement: true, independentEvidenceRequired: true },
    financialRecordsUnchanged: true,
    liveProviderRequestMade: false,
    productionReady: false,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
