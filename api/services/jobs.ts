import { and, desc, eq, lte } from "drizzle-orm";
import { commissionRuleDrafts, jobRuns, rateLimitBuckets } from "@db/schema";
import { getDb } from "../queries/connection";
import { confirmDueDeals, dispatchDuePayouts, runPayoutBatch } from "./ledger";
import { dailyPayoutSlotKey, isDailyPayoutWindow } from "./payoutPolicy";
import { expireRecruitments } from "./recruiting";
import { syncSlaBreaches } from "./support";
import { recalculateCampusLeadEligibility } from "./leadEligibility";
import { log } from "../lib/logger";
import { monitorOperationalSignals } from "./incidents";
import { monitoringSlotKey } from "./incidentPolicy";
import { processDueIngestionRetries, purgeExpiredVendorEventPayloads } from "./ingestionRetries";
import { expireIdentityApprovals } from "./identity";
import { runPromotionScheduleSweep } from "./promotions";

export const JOB_KEYS = ["confirmation_sweep", "draft_expiry", "sla_breach", "recruitment_expiry", "payout_dispatch", "rate_limit_cleanup", "ingestion_retry", "event_retention", "identity_expiry", "promotion_orchestration"] as const;
export type JobKey = typeof JOB_KEYS[number] | "payout_batch" | "lead_eligibility" | "monitoring_sweep";

export async function runDurableJob(jobKey: JobKey, trigger: "manual" | "schedule" = "manual", slotKey: string = crypto.randomUUID()) {
  const db = getDb();
  const claimed = await db.insert(jobRuns).values({ jobKey, slotKey, trigger }).onConflictDoNothing().returning({ id: jobRuns.id });
  if (!claimed.length) return { jobKey, status: "skipped_duplicate" as const, processedCount: 0 };
  const runId = claimed[0].id;
  try {
    let result: Record<string, unknown>;
    let processedCount = 0;
    if (jobKey === "confirmation_sweep") {
      const sweep = await confirmDueDeals();
      result = sweep;
      processedCount = sweep.confirmed;
    } else if (jobKey === "draft_expiry") {
      const expired = await db.update(commissionRuleDrafts).set({ state: "expired" })
        .where(and(eq(commissionRuleDrafts.state, "draft"), lte(commissionRuleDrafts.expiresAt, new Date())))
        .returning({ id: commissionRuleDrafts.id });
      result = { expired: expired.length };
      processedCount = expired.length;
    } else if (jobKey === "sla_breach") {
      const breached = await syncSlaBreaches();
      result = { breached };
      processedCount = breached;
    } else if (jobKey === "payout_dispatch") {
      const dispatched = await dispatchDuePayouts();
      result = dispatched;
      processedCount = dispatched.dispatched;
    } else if (jobKey === "payout_batch") {
      const batch = await runPayoutBatch();
      result = batch;
      processedCount = batch.results.filter((row) => row.status === "queued").length;
    } else if (jobKey === "lead_eligibility") {
      const eligibility = await recalculateCampusLeadEligibility();
      result = eligibility;
      processedCount = eligibility.demoted;
    } else if (jobKey === "monitoring_sweep") {
      const monitored = await monitorOperationalSignals();
      result = monitored;
      processedCount = monitored.created + monitored.updated;
    } else if (jobKey === "rate_limit_cleanup") {
      const deleted = await db.delete(rateLimitBuckets).where(lte(rateLimitBuckets.expiresAt, new Date())).returning({ id: rateLimitBuckets.id });
      result = { deleted: deleted.length };
      processedCount = deleted.length;
    } else if (jobKey === "ingestion_retry") {
      const retries = await processDueIngestionRetries();
      result = retries;
      processedCount = retries.resolved + retries.retryScheduled + retries.deadLetter;
    } else if (jobKey === "event_retention") {
      const retention = await purgeExpiredVendorEventPayloads();
      result = retention;
      processedCount = retention.purged;
    } else if (jobKey === "identity_expiry") {
      result = await expireIdentityApprovals();
      processedCount = Number(result.expired || 0);
    } else if (jobKey === "promotion_orchestration") {
      result = await runPromotionScheduleSweep();
      processedCount = Number(result.processed || 0);
    } else {
      result = await expireRecruitments();
      processedCount = Number(result.expired || 0);
    }
    await db.update(jobRuns).set({ status: "succeeded", finishedAt: new Date(), processedCount, resultJson: result }).where(eq(jobRuns.id, runId));
    return { jobKey, runId, status: "succeeded" as const, processedCount, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(jobRuns).set({ status: "failed", finishedAt: new Date(), error: message.slice(0, 1000) }).where(eq(jobRuns.id, runId));
    log.error("durable job failed", { jobKey, runId, error: message });
    throw error;
  }
}

export async function runDueJobs(trigger: "manual" | "schedule" = "manual") {
  const now = new Date();
  const slot = trigger === "schedule" ? now.toISOString().slice(0, 16) : crypto.randomUUID();
  const results = [];
  if (trigger === "schedule" && isDailyPayoutWindow(now)) {
    results.push(await runDurableJob("payout_batch", trigger, dailyPayoutSlotKey(now)));
  }
  if (trigger === "schedule") {
    results.push(await runDurableJob("lead_eligibility", trigger, now.toISOString().slice(0, 13)));
    results.push(await runDurableJob("monitoring_sweep", trigger, monitoringSlotKey(now)));
  }
  for (const jobKey of JOB_KEYS) results.push(await runDurableJob(jobKey, trigger, slot));
  return { trigger, slot, results };
}

export async function recentJobRuns() {
  return getDb().select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(40);
}

let worker: ReturnType<typeof setInterval> | undefined;
export function startDurableWorker() {
  if (worker) return;
  worker = setInterval(() => {
    runDueJobs("schedule").catch((error) => log.error("scheduled worker pass failed", { error: error instanceof Error ? error.message : String(error) }));
  }, 60_000);
  worker.unref();
  log.info("durable PostgreSQL worker started", { intervalSeconds: 60, jobs: JOB_KEYS });
}
