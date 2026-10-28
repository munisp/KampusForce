import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, max } from "drizzle-orm";
import { dataPlatformRuns, datasetLineage } from "@db/schema";
import { getDb } from "../api/queries/connection";

const [deltaPath, rayPath] = process.argv.slice(2);
if (!deltaPath || !rayPath) throw new Error("Usage: tsx scripts/record-data-platform-evidence.ts run_manifest.json ray_manifest.json");
const delta = JSON.parse(await readFile(resolve(deltaPath), "utf8"));
const ray = JSON.parse(await readFile(resolve(rayPath), "utf8"));
if (delta.engine !== "delta_lake" || delta.mode !== "local_sandbox_reference" || ray.engine !== "ray" || ray.mode !== "local_ray_reference") {
  throw new Error("Only verified local sandbox reference manifests can be recorded by this command");
}
const deltaControls = [
  "strict_field_allowlist",
  "raw_identifier_rejection",
  "timezone_aware_event_times",
  "immutable_bronze_insert_only",
  "replay_deduplication",
  "conflicting_event_id_quarantine",
  "consent_filter",
  "hmac_tokenization",
  "confirmed_only_gold_economics",
  "gold_rebuild_after_tombstone",
];
const rayControls = ["history_only_features", "outcome_date_excluded_from_features", "time_ordered_holdout", "no_random_row_split"];
const probabilityDiagnostics = [ray.baseline_auc, ray.baseline_average_precision, ray.test_brier_score, ray.baseline_brier_score];
if (
  !deltaControls.every((control) => delta.controls?.includes(control)) ||
  !rayControls.every((control) => ray.leakage_controls?.includes(control)) ||
  ray.model_approved !== false ||
  !Number.isSafeInteger(ray.ray_task_batches) || ray.ray_task_batches < 1 ||
  !Number.isSafeInteger(ray.training_rows) || ray.training_rows < 1 ||
  !Number.isSafeInteger(ray.test_rows) || ray.test_rows < 1 ||
  !probabilityDiagnostics.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) ||
  ray.baseline_auc !== 0.5 ||
  typeof ray.temporal_test_start !== "string" ||
  !Number.isSafeInteger(delta.quarantine_rows_written) || delta.quarantine_rows_written < 0
) {
  throw new Error("Manifests do not satisfy the expanded privacy, economics, immutable Bronze, temporal probability-diagnostic and approval-locked evidence contracts");
}
const db = getDb();
const recorded = await db.transaction(async (tx) => {
  const runs = await tx.insert(dataPlatformRuns).values([
    { runRef: delta.run_ref, layer: "medallion_pipeline", engine: "delta_lake", mode: "sandbox", state: "succeeded", inputHash: delta.input_hash, outputHash: delta.output_hash, rowsProcessed: delta.rows_processed, quarantinedRows: delta.quarantined_rows, detailsJson: delta, deletionEvidenceJson: delta.deletion_evidence, completedAt: new Date() },
    { runRef: ray.run_ref, layer: "rep_opportunity_scoring", engine: "ray", mode: "sandbox", state: "succeeded", inputHash: ray.input_hash, outputHash: ray.output_hash, rowsProcessed: ray.rows_processed, quarantinedRows: 0, detailsJson: ray, completedAt: new Date() },
  ]).onConflictDoNothing().returning({ runRef: dataPlatformRuns.runRef });
  if (runs.length !== 2) throw new Error("A run reference is already recorded; use a new immutable run rather than overwriting evidence");

  const lineage = [
    { datasetKey: "bronze.activation_events", sourceDatasets: ["postgresql.pseudonymized_consented_export"], transform: "Schema validation, insert-only immutable replay, conflicting-ID quarantine and DSAR tombstones", consentPolicy: "Raw identifiers rejected; customer references remain pseudonymized", accessScope: "data_engineering_only", outputHash: delta.output_hash },
    { datasetKey: "silver.activation_events", sourceDatasets: ["bronze.activation_events"], transform: "Consent filter, HMAC tokenization and conformed activation schema", consentPolicy: "Consented rows only; DSAR deletes propagated", accessScope: "analytics_engineering_only", outputHash: delta.output_hash },
    { datasetKey: "gold.rep_performance", sourceDatasets: ["silver.activation_events"], transform: "Representative-day activation and commission aggregates", consentPolicy: "No direct customer identifiers", accessScope: "operations_scoped_and_vendor_campus_row_policies_required_for_external_serving", outputHash: delta.output_hash },
    { datasetKey: "gold.rep_opportunity_scores", sourceDatasets: ["gold.rep_performance"], transform: "History-only temporal logistic regression with time-ordered evaluation and Ray batch scoring", consentPolicy: "Pseudonymous representative tokens only; human decision support; model approval remains closed", accessScope: "operations_only_reference", outputHash: ray.output_hash },
  ];
  for (const item of lineage) {
    const [current] = await tx.select({ version: max(datasetLineage.version) }).from(datasetLineage).where(eq(datasetLineage.datasetKey, item.datasetKey));
    await tx.insert(datasetLineage).values({ ...item, version: Number(current?.version || 0) + 1 });
  }
  return { runs: runs.map((run) => run.runRef), lineage: lineage.length };
});
console.log(JSON.stringify({ ...recorded, mode: "sandbox_reference_only" }));
process.exit(0);
