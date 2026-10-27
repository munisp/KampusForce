import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  postgresConnectionEnv,
  recoveryCounts,
  runPostgresTool,
} from "./lib/postgresTools";

async function main() {
  if (process.env.KF_RECOVERY_DRILL !== "sandbox") {
    throw new Error("Set KF_RECOVERY_DRILL=sandbox to authorize an isolated sandbox restore drill");
  }
  const backup = path.resolve(process.argv[2] || "");
  if (!process.argv[2] || !existsSync(backup)) throw new Error("Provide an existing PostgreSQL custom-format backup");

  const sourceEnv = postgresConnectionEnv();
  const sourceDatabase = sourceEnv.PGDATABASE;
  const restoreDatabase = `kf_restore_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  assert.notEqual(restoreDatabase, sourceDatabase);
  const sourceBefore = recoveryCounts();

  runPostgresTool("createdb", ["--maintenance-db=postgres", restoreDatabase], postgresConnectionEnv("postgres"));
  runPostgresTool("pg_restore", [
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    restoreDatabase,
    backup,
  ], postgresConnectionEnv(restoreDatabase));

  const restored = recoveryCounts(restoreDatabase);
  assert.deepEqual(restored, sourceBefore, "Restored table counts differ from the source snapshot");
  const sourceAfter = recoveryCounts();
  assert.deepEqual(sourceAfter, sourceBefore, "Source records changed during the recovery drill");

  console.log(JSON.stringify({
    status: "passed",
    mode: "isolated_sandbox_restore",
    backup,
    sourceDatabase,
    restoreDatabase,
    restoreDatabaseKept: true,
    sourceModified: false,
    counts: restored,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
