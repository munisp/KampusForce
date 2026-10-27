import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { postgresConnectionEnv, runPostgresTool } from "./lib/postgresTools";

async function main() {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const output = path.resolve(process.argv[2] || path.join("backups", `kampusforce-${stamp}.dump`));
  if (existsSync(output)) throw new Error(`Backup already exists: ${output}`);
  await mkdir(path.dirname(output), { recursive: true });

  runPostgresTool("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    output,
  ], postgresConnectionEnv());
  const file = await stat(output);
  assert.ok(file.size > 0, "Backup is empty");
  const manifest = runPostgresTool("pg_restore", ["--list", output], postgresConnectionEnv());
  assert.ok(manifest.includes("TABLE DATA"), "Backup manifest contains no table data");

  console.log(JSON.stringify({
    status: "created",
    format: "postgresql_custom",
    file: output,
    bytes: file.size,
    manifestValidated: true,
    sourceModified: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
