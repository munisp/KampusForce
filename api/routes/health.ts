import { Hono } from "hono";
import { and, desc, eq, gt } from "drizzle-orm";
import { jobRuns, notificationDeliveries, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { log } from "../lib/logger";
import { integrationConfiguration } from "../services/integrationConfig";
import { notificationDeliveryConfiguration } from "../services/notificationDelivery";

export const healthRoutes = new Hono();

healthRoutes.get("/live", (c) => {
  const configuration = integrationConfiguration();
  return c.json({ status: "ok", service: "kampusforce", mode: configuration.effectiveMode, requestedMode: configuration.requestedMode });
});

healthRoutes.get("/ready", async (c) => {
  const configuration = integrationConfiguration();
  const delivery = notificationDeliveryConfiguration();
  try {
    await getDb().select({ id: users.id }).from(users).limit(1);
    const freshAfter = new Date(Date.now() - 5 * 60_000);
    const [latestJob] = await getDb().select({ startedAt: jobRuns.startedAt, status: jobRuns.status })
      .from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(1);
    const [freshSuccessfulJob] = await getDb().select({ startedAt: jobRuns.startedAt }).from(jobRuns)
      .where(and(eq(jobRuns.status, "succeeded"), gt(jobRuns.startedAt, freshAfter))).orderBy(desc(jobRuns.startedAt)).limit(1);
    const [deadLetter] = await getDb().select({ id: notificationDeliveries.id }).from(notificationDeliveries)
      .where(eq(notificationDeliveries.state, "dead_letter")).limit(1);
    const workerStarting = process.uptime() < 120 && !latestJob;
    const workerFresh = Boolean(freshSuccessfulJob) || workerStarting;
    const providerConfigurationValid = configuration.requestedMode !== "invalid" && (configuration.requestedMode !== "live" || configuration.effectiveMode === "live");
    const ready = workerFresh && providerConfigurationValid && !delivery.misconfigured;
    return c.json({
      status: ready ? "ready" : "not_ready",
      mode: configuration.effectiveMode,
      requestedMode: configuration.requestedMode,
      checks: {
        database: "up",
        worker: workerFresh ? "fresh" : "stale",
        providerConfiguration: providerConfigurationValid ? "valid" : "invalid",
        notificationDelivery: delivery.misconfigured ? "misconfigured" : delivery.enabled ? "configured" : "disabled",
        notificationDeadLettersPresent: Boolean(deadLetter),
        latestJobAt: latestJob?.startedAt || null,
        latestSuccessfulJobAt: freshSuccessfulJob?.startedAt || null,
      },
    }, ready ? 200 : 503);
  } catch (error) {
    log.error("readiness check failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ status: "not_ready", mode: configuration.effectiveMode, checks: { database: "down" } }, 503);
  }
});
