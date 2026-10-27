import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { jobRuns, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { log } from "../lib/logger";

export const healthRoutes = new Hono();

healthRoutes.get("/live", (c) => c.json({
  status: "ok",
  service: "kampusforce",
  mode: "sandbox",
}));

healthRoutes.get("/ready", async (c) => {
  try {
    await getDb().select({ id: users.id }).from(users).limit(1);
    const [latestJob] = await getDb().select({ startedAt: jobRuns.startedAt, status: jobRuns.status })
      .from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(1);
    return c.json({
      status: "ready",
      mode: "sandbox",
      checks: {
        database: "up",
        worker: "postgresql_minute_worker",
        latestJobAt: latestJob?.startedAt || null,
      },
    });
  } catch (error) {
    log.error("readiness check failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ status: "not_ready", mode: "sandbox", checks: { database: "down" } }, 503);
  }
});
