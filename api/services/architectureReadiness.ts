import { desc, eq } from "drizzle-orm";
import { dataPlatformRuns, datasetLineage, mojaloopRailIntents } from "@db/schema";
import { getDb } from "../queries/connection";
import { financialOutboxStatus, tigerBeetleReadiness } from "./tigerBeetle";
import { mojaloopReadiness } from "./mojaloop";

export async function architectureReadiness() {
  const db = getDb();
  const [deltaRuns, rayRuns, lineage, outbox, mojaloopIntents] = await Promise.all([
    db.select().from(dataPlatformRuns).where(eq(dataPlatformRuns.engine, "delta_lake")).orderBy(desc(dataPlatformRuns.startedAt)).limit(5),
    db.select().from(dataPlatformRuns).where(eq(dataPlatformRuns.engine, "ray")).orderBy(desc(dataPlatformRuns.startedAt)).limit(5),
    db.select().from(datasetLineage).orderBy(desc(datasetLineage.createdAt)).limit(20),
    financialOutboxStatus(),
    db.select({ intentRef: mojaloopRailIntents.intentRef, payoutId: mojaloopRailIntents.payoutId, amountNetKobo: mojaloopRailIntents.amountNetKobo, state: mojaloopRailIntents.state, lastErrorCode: mojaloopRailIntents.lastErrorCode, createdAt: mojaloopRailIntents.createdAt }).from(mojaloopRailIntents).orderBy(desc(mojaloopRailIntents.createdAt)).limit(20),
  ]);
  const deltaEvidence = deltaRuns.find((run) => run.state === "succeeded" && run.mode === "sandbox");
  const rayEvidence = rayRuns.find((run) => run.state === "succeeded" && run.mode === "sandbox");
  const tiger = tigerBeetleReadiness();
  const mojaloop = mojaloopReadiness();
  const rayDetails = rayEvidence?.detailsJson as {
    test_auc?: unknown;
    baseline_auc?: unknown;
    test_average_precision?: unknown;
    baseline_average_precision?: unknown;
    test_brier_score?: unknown;
    baseline_brier_score?: unknown;
    train_positive_rows?: unknown;
    test_positive_rows?: unknown;
    evaluation_warning?: unknown;
    temporal_test_start?: unknown;
    training_rows?: unknown;
    test_rows?: unknown;
    model_approved?: unknown;
  } | undefined;
  const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const modelEvidence = rayEvidence ? {
    testAuc: numberOrNull(rayDetails?.test_auc),
    baselineAuc: numberOrNull(rayDetails?.baseline_auc),
    testAveragePrecision: numberOrNull(rayDetails?.test_average_precision),
    baselineAveragePrecision: numberOrNull(rayDetails?.baseline_average_precision),
    testBrierScore: numberOrNull(rayDetails?.test_brier_score),
    baselineBrierScore: numberOrNull(rayDetails?.baseline_brier_score),
    trainPositiveRows: numberOrNull(rayDetails?.train_positive_rows),
    testPositiveRows: numberOrNull(rayDetails?.test_positive_rows),
    evaluationWarning: typeof rayDetails?.evaluation_warning === "string" ? rayDetails.evaluation_warning : null,
    temporalTestStart: typeof rayDetails?.temporal_test_start === "string" ? rayDetails.temporal_test_start : null,
    trainingRows: typeof rayDetails?.training_rows === "number" ? rayDetails.training_rows : 0,
    testRows: typeof rayDetails?.test_rows === "number" ? rayDetails.test_rows : 0,
    approved: rayDetails?.model_approved === true,
  } : null;
  return {
    lakehouse: {
      implementation: "Executable Delta Lake bronze/silver/gold reference pipeline with immutable replay, conflict quarantine, consent, tokenization, lineage and DSAR evidence",
      localReferenceVerified: Boolean(deltaEvidence),
      latestEvidence: deltaEvidence || null,
      productionReady: false,
      blockers: ["Production object storage and multi-writer credentials", "Flink and Spark deployment", "Sedona cluster and geospatial workload validation", "External row-level serving policies", "Scheduled backup, restore and retention evidence"],
      boundary: "Local Delta evidence does not certify a production lakehouse or distributed streaming deployment.",
    },
    ray: {
      implementation: "History-only temporal training, real Ray batch scoring and an approval-gated Ray Serve application with authentication, autoscaling, health checks and bounded queues",
      localReferenceVerified: Boolean(rayEvidence),
      latestEvidence: rayEvidence || null,
      modelEvidence,
      productionReady: false,
      blockers: ["Managed Ray cluster and network policy", "Production training data and model validation", "Model registry approval and drift monitoring", "Ray Serve load, failover and autoscaling acceptance"],
      boundary: "The local baseline is decision-support evidence, not a production model or an automated eligibility decision.",
    },
    tigerbeetle: {
      implementation: "PostgreSQL transactional outbox, deterministic u128 IDs, balanced linked batches, two-phase transfer builders and official client adapter",
      readiness: tiger,
      outbox,
      productionReady: false,
      blockers: ["Configured and verified TigerBeetle replicas", "Backfill and opening-balance proof", "Hourly account-balance reconciliation evidence", "Zero unexplained outbox failures", "Independent ledger-of-record cutover approval"],
    },
    mojaloop: {
      implementation: "Fail-closed party lookup → quote → transfer contract with economics checks, idempotency and explicit settlement boundary",
      readiness: mojaloop,
      intents: mojaloopIntents,
      productionReady: false,
      launchDependency: false,
      blockers: ["Approved scheme participation and partner FSP", "mTLS and JWS verification evidence", "Hub connectivity and liquidity", "Verified final outcome callbacks", "Independent settlement-report reconciliation"],
    },
    lineage,
    specificationBoundary: "All deployable product controls are not equivalent to all external production integrations being live. Legal, banking, KYC, tax, telecom, object-storage, cluster and scheme gates remain external evidence requirements.",
  };
}
