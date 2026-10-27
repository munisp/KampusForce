import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const LOCAL_PG16_BIN = "/tmp/kf-pg16/usr/lib/postgresql/16/bin";

function postgresBinary(name: string) {
  const directories = [process.env.PG_BIN, LOCAL_PG16_BIN, "/usr/lib/postgresql/16/bin"].filter(Boolean) as string[];
  for (const directory of directories) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

export function postgresConnectionEnv(database?: string) {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("POSTGRES_URL is required");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("POSTGRES_URL must be PostgreSQL");
  const sourceDatabase = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!database && !sourceDatabase) throw new Error("POSTGRES_URL must include a database name");
  const sslMode = url.searchParams.get("sslmode");
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database || sourceDatabase,
    PGCONNECT_TIMEOUT: "10",
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

export function runPostgresTool(
  name: "createdb" | "pg_dump" | "pg_restore" | "psql",
  args: string[],
  env: ReturnType<typeof postgresConnectionEnv>,
) {
  const result = spawnSync(postgresBinary(name), args, {
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`${name} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit status ${result.status}`;
    throw new Error(`${name} failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function recoveryCounts(database?: string) {
  const output = runPostgresTool("psql", [
    "--tuples-only",
    "--no-align",
    "--no-psqlrc",
    "--command",
    `SELECT json_build_object(
      'users', (SELECT count(*) FROM public.users),
      'reps', (SELECT count(*) FROM public.reps),
      'products', (SELECT count(*) FROM public.products),
      'deals', (SELECT count(*) FROM public.deals),
      'ledgerEntries', (SELECT count(*) FROM public.ledger_entries),
      'auditLogs', (SELECT count(*) FROM public.audit_logs),
      'rateLimitBuckets', (SELECT count(*) FROM public.rate_limit_buckets),
      'migrations', (SELECT count(*) FROM drizzle.__drizzle_migrations),
      'userTriggers', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)
    )::text`,
  ], postgresConnectionEnv(database));
  return JSON.parse(output) as Record<string, number>;
}
