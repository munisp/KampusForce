import { and, desc, eq, lte } from "drizzle-orm";
import {
  commissionRecurrenceReceipts,
  commissionRecurrenceSchedules,
  commissionRules,
  products,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { assertSalesRole, type SalesActor } from "./salesAccess";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function addRecurrenceMonths(value: Date, months: number) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()));
  return result;
}

export async function renewalScheduleForCustomer(tx: Tx, input: { vendorId: number; productId: number; customerPhoneHash: string }) {
  const [schedule] = await tx.select().from(commissionRecurrenceSchedules).where(and(
    eq(commissionRecurrenceSchedules.vendorId, input.vendorId),
    eq(commissionRecurrenceSchedules.productId, input.productId),
    eq(commissionRecurrenceSchedules.customerPhoneHash, input.customerPhoneHash),
  )).orderBy(desc(commissionRecurrenceSchedules.id)).limit(1).for("update");
  return schedule || null;
}

export function renewalAdmissionProblem(schedule: typeof commissionRecurrenceSchedules.$inferSelect | null, now: Date) {
  if (!schedule) return null;
  if (["completed", "cancelled"].includes(schedule.state) || schedule.cycleNumber >= schedule.maxCycles) return "Verified recurrence limit reached; no further commission cycle is eligible";
  if (schedule.nextDueAt && schedule.nextDueAt > now) return `Renewal evidence is before the next eligible cycle at ${schedule.nextDueAt.toISOString()}`;
  return null;
}

export async function recordVerifiedRenewalRecurrence(tx: Tx, input: {
  dealId: number;
  vendorId: number;
  productId: number;
  repId: number;
  commissionRuleId: number;
  customerPhoneHash: string;
  customerRefHash: string;
  vendorEventId: string;
  promotionLinkId?: number | null;
  scheduleId?: number | null;
}) {
  const now = new Date();
  const [rule] = await tx.select().from(commissionRules).where(eq(commissionRules.id, input.commissionRuleId)).limit(1);
  if (!rule || rule.triggerEvent !== "renewal") throw new Error("A renewal commission rule is required for recurrence scheduling");
  const schedule = input.scheduleId
    ? (await tx.select().from(commissionRecurrenceSchedules).where(eq(commissionRecurrenceSchedules.id, input.scheduleId)).for("update").limit(1))[0]
    : null;
  if (!schedule) {
    const nextDueAt = rule.recurrenceMonths > 1 ? addRecurrenceMonths(now, rule.recurrenceIntervalMonths) : null;
    const [created] = await tx.insert(commissionRecurrenceSchedules).values({
      originalDealId: input.dealId,
      lastDealId: input.dealId,
      vendorId: input.vendorId,
      productId: input.productId,
      repId: input.repId,
      commissionRuleId: rule.id,
      promotionLinkId: input.promotionLinkId || null,
      customerPhoneHash: input.customerPhoneHash,
      customerRefHash: input.customerRefHash,
      cycleNumber: 1,
      maxCycles: rule.recurrenceMonths,
      intervalMonths: rule.recurrenceIntervalMonths,
      nextDueAt,
      state: nextDueAt ? "scheduled" : "completed",
    }).onConflictDoNothing().returning();
    if (created) await tx.insert(commissionRecurrenceReceipts).values({ scheduleId: created.id, cycleNumber: 1, receiptType: "verified_renewal", vendorEventId: input.vendorEventId, dealId: input.dealId, detail: "Initial vendor-verified renewal recorded; elapsed time alone creates no further entitlement" }).onConflictDoNothing();
    return { scheduleId: created?.id || null, cycleNumber: 1, nextDueAt, state: created?.state || "scheduled" };
  }
  const cycleNumber = schedule.cycleNumber + 1;
  if (cycleNumber > schedule.maxCycles) throw new Error("Recurrence limit changed while the renewal was being processed");
  const nextDueAt = cycleNumber < schedule.maxCycles ? addRecurrenceMonths(now, schedule.intervalMonths) : null;
  await tx.update(commissionRecurrenceSchedules).set({ lastDealId: input.dealId, cycleNumber, nextDueAt, state: nextDueAt ? "scheduled" : "completed", version: schedule.version + 1, updatedAt: now }).where(eq(commissionRecurrenceSchedules.id, schedule.id));
  await tx.insert(commissionRecurrenceReceipts).values({ scheduleId: schedule.id, cycleNumber, receiptType: "verified_renewal", vendorEventId: input.vendorEventId, dealId: input.dealId, detail: "Due vendor-verified renewal accepted through the existing activation path; historical 80/20 economics preserved" }).onConflictDoNothing();
  return { scheduleId: schedule.id, cycleNumber, nextDueAt, state: nextDueAt ? "scheduled" : "completed" };
}

export async function runRecurrenceSweep(actor: SalesActor, now = new Date()) {
  assertSalesRole(actor, ["vendor", "ops", "admin"]);
  const db = getDb();
  const vendorScope = actor.role === "vendor" ? eq(commissionRecurrenceSchedules.vendorId, actor.vendorId || -1) : undefined;
  const due = await db.select().from(commissionRecurrenceSchedules).where(and(
    eq(commissionRecurrenceSchedules.state, "scheduled"),
    lte(commissionRecurrenceSchedules.nextDueAt, now),
    vendorScope,
  )).orderBy(commissionRecurrenceSchedules.nextDueAt).limit(100);
  let awaitingEvidence = 0;
  for (const schedule of due) {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(commissionRecurrenceSchedules).where(eq(commissionRecurrenceSchedules.id, schedule.id)).for("update").limit(1);
      if (!current || current.state !== "scheduled" || !current.nextDueAt || current.nextDueAt > now) return;
      await tx.update(commissionRecurrenceSchedules).set({ state: "awaiting_evidence", version: current.version + 1, updatedAt: now }).where(eq(commissionRecurrenceSchedules.id, current.id));
      await tx.insert(commissionRecurrenceReceipts).values({ scheduleId: current.id, cycleNumber: current.cycleNumber + 1, receiptType: "awaiting_evidence", detail: "Cycle is due; no deal, ledger entry or payout is created until a signed vendor renewal event clears the existing activation controls" }).onConflictDoNothing();
      awaitingEvidence += 1;
    });
  }
  return { due: due.length, awaitingEvidence, dealsCreated: 0, ledgerEntriesCreated: 0, evidenceRequired: true };
}

export async function listRecurrenceWorkspace(actor: SalesActor) {
  assertSalesRole(actor, ["vendor", "ops", "finance", "admin"]);
  const db = getDb();
  const scope = actor.role === "vendor" ? eq(commissionRecurrenceSchedules.vendorId, actor.vendorId || -1) : undefined;
  const schedules = await db.select({ schedule: commissionRecurrenceSchedules, productName: products.name, ruleVersion: commissionRules.version }).from(commissionRecurrenceSchedules)
    .innerJoin(products, eq(commissionRecurrenceSchedules.productId, products.id)).innerJoin(commissionRules, eq(commissionRecurrenceSchedules.commissionRuleId, commissionRules.id))
    .where(scope).orderBy(desc(commissionRecurrenceSchedules.updatedAt)).limit(100);
  const ids = schedules.map((row) => row.schedule.id);
  const receipts = ids.length ? await db.select({ receipt: commissionRecurrenceReceipts }).from(commissionRecurrenceReceipts).innerJoin(commissionRecurrenceSchedules, eq(commissionRecurrenceReceipts.scheduleId, commissionRecurrenceSchedules.id)).where(scope).orderBy(desc(commissionRecurrenceReceipts.createdAt)).limit(300) : [];
  return {
    schedules,
    receipts,
    metrics: {
      scheduled: schedules.filter((row) => row.schedule.state === "scheduled").length,
      awaitingEvidence: schedules.filter((row) => row.schedule.state === "awaiting_evidence").length,
      completed: schedules.filter((row) => row.schedule.state === "completed").length,
      cyclesVerified: receipts.filter((row) => row.receipt.receiptType === "verified_renewal").length,
    },
    controls: { maximumCyclesAdjustable: true, intervalMonthsAdjustable: true, vendorEvidenceRequired: true, standardRepShareBps: 8000, platformShareBps: 2000, campusLeadOverrideBps: 500, historicalRulesPreserved: true },
    boundary: "A due date only moves a schedule to awaiting evidence. A qualifying signed renewal event must still pass attribution, product, capacity, velocity and ledger controls before a new deal exists.",
  };
}
