import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  activationVelocityBuckets,
  auditLogs,
  campuses,
  fraudCaseEvents,
  fraudCases,
  fraudHolds,
  reps,
  users,
  type FraudCase,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { notifyOperations } from "./notifications";
import {
  activationCapExceeded,
  activationDayWindow,
  fraudReviewDueAt,
  isFraudReviewOverdue,
} from "./fraudPolicy";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type FraudClient = Database | Transaction;

function caseRef() {
  return `FR-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function insertFraudCase(tx: Transaction, input: {
  repId: number;
  reason: FraudCase["reason"];
  actorUserId: number | null;
  note: string;
  dedupeKey: string;
  sourceKey?: string;
  evidence: Record<string, unknown>;
  createdAt?: Date;
}) {
  const createdAt = input.createdAt || new Date();
  const reviewDueAt = fraudReviewDueAt(createdAt);
  const [fraudCase] = await tx.insert(fraudCases).values({
    caseRef: caseRef(),
    repId: input.repId,
    reason: input.reason,
    dedupeKey: input.dedupeKey,
    sourceKey: input.sourceKey || null,
    reviewDueAt,
    evidenceJson: input.evidence,
    openedByUserId: input.actorUserId,
    createdAt,
    updatedAt: createdAt,
  }).returning();
  const [hold] = await tx.insert(fraudHolds).values({ caseId: fraudCase.id, repId: input.repId, createdAt }).returning();
  await tx.insert(fraudCaseEvents).values({
    caseId: fraudCase.id,
    actorUserId: input.actorUserId,
    action: "opened",
    toState: "open",
    note: input.note,
    evidenceJson: { ...input.evidence, reviewDueAt: reviewDueAt.toISOString(), payoutHold: "active" },
  });
  await tx.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: "fraud.case.opened",
    entityType: "fraud_case",
    entityId: String(fraudCase.id),
    metadataJson: { caseRef: fraudCase.caseRef, repId: input.repId, reason: input.reason, reviewDueAt: reviewDueAt.toISOString(), payoutHold: "active" },
  });
  return { fraudCase, hold, created: true as const };
}

async function openCaseWithRepLock(tx: Transaction, input: Parameters<typeof insertFraudCase>[1]) {
  const [rep] = await tx.select().from(reps).where(eq(reps.id, input.repId)).limit(1).for("update");
  if (!rep) throw new TRPCError({ code: "NOT_FOUND", message: "Representative not found" });
  return insertFraudCase(tx, input);
}

export async function enforceActivationVelocity(tx: Transaction, input: {
  repId: number;
  productId: number;
  triggerEvent: string;
  eventId: string;
  cap: number;
  now?: Date;
}) {
  const now = input.now || new Date();
  const { windowStart, windowEnd, localDay } = activationDayWindow(now);
  const [bucket] = await tx.insert(activationVelocityBuckets).values({
    repId: input.repId,
    windowStart,
    windowEnd,
    attemptCount: 1,
    cap: input.cap,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [activationVelocityBuckets.repId, activationVelocityBuckets.windowStart],
    set: {
      attemptCount: sql`${activationVelocityBuckets.attemptCount} + 1`,
      cap: input.cap,
      updatedAt: now,
    },
  }).returning();
  if (!activationCapExceeded(bucket.attemptCount, input.cap)) {
    return { blocked: false as const, attemptCount: bucket.attemptCount, cap: input.cap, windowStart, windowEnd };
  }

  const sourceKey = `velocity:${input.repId}:${localDay}`;
  const [latest] = await tx.select().from(fraudCases).where(eq(fraudCases.sourceKey, sourceKey)).orderBy(desc(fraudCases.createdAt)).limit(1);
  if (latest && latest.state !== "released") {
    return { blocked: true as const, caseId: latest.id, caseRef: latest.caseRef, attemptCount: bucket.attemptCount, cap: input.cap, windowStart, windowEnd };
  }
  const opened = await openCaseWithRepLock(tx, {
    repId: input.repId,
    reason: "activation_velocity",
    actorUserId: null,
    note: `Daily activation cap exceeded: ${bucket.attemptCount} unique submissions against a cap of ${input.cap}.`,
    dedupeKey: latest ? `${sourceKey}:${bucket.attemptCount}` : sourceKey,
    sourceKey,
    evidence: {
      rule: "rep_daily_activation_cap",
      productId: input.productId,
      triggerEvent: input.triggerEvent,
      eventId: input.eventId,
      attemptCount: bucket.attemptCount,
      cap: input.cap,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      timezone: "Africa/Lagos",
    },
    createdAt: now,
  });
  return { blocked: true as const, caseId: opened.fraudCase.id, caseRef: opened.fraudCase.caseRef, attemptCount: bucket.attemptCount, cap: input.cap, windowStart, windowEnd };
}

export async function createOperationsFraudCase(input: { repId: number; actorUserId: number; note: string }) {
  const opened = await getDb().transaction(async (tx) => openCaseWithRepLock(tx, {
    repId: input.repId,
    reason: "operations_review",
    actorUserId: input.actorUserId,
    note: input.note,
    dedupeKey: `manual:${randomUUID()}`,
    evidence: { rule: "operations_manual_review", payoutHold: "active" },
  }));
  await notifyOperations({
    type: "fraud_case",
    title: `Fraud hold opened: ${opened.fraudCase.caseRef}`,
    body: `Review is due ${opened.fraudCase.reviewDueAt.toISOString()}. New payout assembly and dispatch are blocked while the hold is active.`,
    href: "/ops",
    entityType: "fraud_case",
    entityId: opened.fraudCase.id,
  });
  return { caseId: opened.fraudCase.id, caseRef: opened.fraudCase.caseRef, state: opened.fraudCase.state, reviewDueAt: opened.fraudCase.reviewDueAt };
}

export async function blockingFraudHold(tx: FraudClient, repId: number) {
  const [row] = await tx.select({ hold: fraudHolds, fraudCase: fraudCases }).from(fraudHolds)
    .innerJoin(fraudCases, eq(fraudHolds.caseId, fraudCases.id))
    .where(and(eq(fraudHolds.repId, repId), inArray(fraudHolds.state, ["active", "upheld"])))
    .orderBy(desc(fraudHolds.createdAt)).limit(1);
  return row || null;
}

export async function assertNoFraudHold(tx: Transaction, repId: number) {
  await tx.select({ id: reps.id }).from(reps).where(eq(reps.id, repId)).limit(1).for("update");
  const blocking = await blockingFraudHold(tx, repId);
  if (blocking) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Payout blocked by fraud case ${blocking.fraudCase.caseRef}; Operations must release the hold first` });
  }
}

export async function reviewFraudCase(input: {
  caseId: number;
  actorUserId: number;
  decision: "release" | "uphold";
  conductAction: "strike" | "suspension";
  note: string;
}) {
  return getDb().transaction(async (tx) => {
    const [fraudCase] = await tx.select().from(fraudCases).where(eq(fraudCases.id, input.caseId)).limit(1).for("update");
    if (!fraudCase) throw new TRPCError({ code: "NOT_FOUND", message: "Fraud case not found" });
    if (!["open", "appeal_open"].includes(fraudCase.state)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Fraud case ${fraudCase.caseRef} has already been ${fraudCase.state}` });
    }
    const [rep] = await tx.select().from(reps).where(eq(reps.id, fraudCase.repId)).limit(1).for("update");
    const [hold] = await tx.select().from(fraudHolds).where(eq(fraudHolds.caseId, fraudCase.id)).limit(1).for("update");
    if (!rep || !hold) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Fraud case hold or representative record is missing" });
    const now = new Date();
    const released = input.decision === "release";
    const nextState = released ? "released" as const : "upheld" as const;
    const conductAction = released ? "none" as const : input.conductAction;
    let priorRepStatus = fraudCase.priorRepStatus;

    if (!released && conductAction === "suspension" && rep.status !== "suspended") {
      priorRepStatus = rep.status;
      await tx.update(reps).set({ status: "suspended" }).where(eq(reps.id, rep.id));
    }
    if (released && fraudCase.state === "appeal_open" && fraudCase.conductAction === "suspension" && rep.status === "suspended") {
      const [otherSuspension] = await tx.select({ id: fraudCases.id }).from(fraudCases).where(and(
        eq(fraudCases.repId, rep.id),
        eq(fraudCases.state, "upheld"),
        eq(fraudCases.conductAction, "suspension"),
        ne(fraudCases.id, fraudCase.id),
      )).limit(1);
      if (!otherSuspension && fraudCase.priorRepStatus !== "suspended") {
        await tx.update(reps).set({ status: fraudCase.priorRepStatus || "active" }).where(eq(reps.id, rep.id));
      }
    }

    await tx.update(fraudCases).set({
      state: nextState,
      reviewedByUserId: input.actorUserId,
      reviewedAt: now,
      reviewNote: input.note,
      conductAction,
      priorRepStatus,
      updatedAt: now,
    }).where(eq(fraudCases.id, fraudCase.id));
    await tx.update(fraudHolds).set({ state: released ? "released" : "upheld", resolvedAt: now }).where(eq(fraudHolds.id, hold.id));
    await tx.insert(fraudCaseEvents).values({
      caseId: fraudCase.id,
      actorUserId: input.actorUserId,
      action: released ? "released" : "upheld",
      fromState: fraudCase.state,
      toState: nextState,
      note: input.note,
      evidenceJson: {
        conductAction,
        payoutHold: released ? "released" : "upheld",
        financialReversalApplied: false,
        clawbackRequired: !released,
      },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: `fraud.case.${nextState}`,
      entityType: "fraud_case",
      entityId: String(fraudCase.id),
      metadataJson: {
        caseRef: fraudCase.caseRef,
        fromState: fraudCase.state,
        toState: nextState,
        conductAction,
        financialReversalApplied: false,
      },
    });
    return { caseId: fraudCase.id, caseRef: fraudCase.caseRef, state: nextState, conductAction, financialReversalApplied: false, clawbackRequired: !released };
  });
}

export async function requestFraudAppeal(input: { caseId: number; repId: number; actorUserId: number; note: string }) {
  const result = await getDb().transaction(async (tx) => {
    const [fraudCase] = await tx.select().from(fraudCases).where(and(eq(fraudCases.id, input.caseId), eq(fraudCases.repId, input.repId))).limit(1).for("update");
    if (!fraudCase) throw new TRPCError({ code: "NOT_FOUND", message: "Fraud case not found" });
    if (fraudCase.state !== "upheld") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an upheld fraud case can be appealed" });
    const now = new Date();
    const reviewDueAt = fraudReviewDueAt(now);
    await tx.update(fraudCases).set({ state: "appeal_open", appealNote: input.note, appealRequestedAt: now, reviewDueAt, updatedAt: now }).where(eq(fraudCases.id, fraudCase.id));
    await tx.insert(fraudCaseEvents).values({
      caseId: fraudCase.id,
      actorUserId: input.actorUserId,
      action: "appeal_requested",
      fromState: "upheld",
      toState: "appeal_open",
      note: input.note,
      evidenceJson: { reviewDueAt: reviewDueAt.toISOString(), payoutHold: "upheld" },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "fraud.case.appeal_requested",
      entityType: "fraud_case",
      entityId: String(fraudCase.id),
      metadataJson: { caseRef: fraudCase.caseRef, reviewDueAt: reviewDueAt.toISOString() },
    });
    return { caseId: fraudCase.id, caseRef: fraudCase.caseRef, state: "appeal_open" as const, reviewDueAt };
  });
  await notifyOperations({
    type: "fraud_appeal",
    title: `Fraud appeal requested: ${result.caseRef}`,
    body: `The representative submitted an appeal. Review is due ${result.reviewDueAt.toISOString()}; the upheld hold remains in force.`,
    href: "/ops",
    entityType: "fraud_case",
    entityId: result.caseId,
  });
  return result;
}

export async function listFraudDesk() {
  const db = getDb();
  const [caseRows, holds, events, repOptions] = await Promise.all([
    db.select({ fraudCase: fraudCases, rep: reps, user: users, campus: campuses }).from(fraudCases)
      .innerJoin(reps, eq(fraudCases.repId, reps.id))
      .innerJoin(users, eq(reps.userId, users.id))
      .innerJoin(campuses, eq(reps.campusId, campuses.id))
      .orderBy(desc(fraudCases.createdAt)).limit(100),
    db.select().from(fraudHolds).orderBy(desc(fraudHolds.createdAt)).limit(150),
    db.select().from(fraudCaseEvents).orderBy(desc(fraudCaseEvents.createdAt)).limit(250),
    db.select({ rep: reps, user: users, campus: campuses }).from(reps)
      .innerJoin(users, eq(reps.userId, users.id))
      .innerJoin(campuses, eq(reps.campusId, campuses.id))
      .orderBy(users.name),
  ]);
  const now = new Date();
  return {
    cases: caseRows.map((row) => ({ ...row, overdue: isFraudReviewOverdue(row.fraudCase, now) })),
    holds,
    events,
    repOptions,
  };
}

export async function listRepFraudCases(repId: number) {
  const db = getDb();
  const [caseRows, holds, events] = await Promise.all([
    db.select().from(fraudCases).where(eq(fraudCases.repId, repId)).orderBy(desc(fraudCases.createdAt)).limit(50),
    db.select({ hold: fraudHolds }).from(fraudHolds).innerJoin(fraudCases, eq(fraudHolds.caseId, fraudCases.id)).where(eq(fraudHolds.repId, repId)).orderBy(desc(fraudHolds.createdAt)),
    db.select({ event: fraudCaseEvents }).from(fraudCaseEvents).innerJoin(fraudCases, eq(fraudCaseEvents.caseId, fraudCases.id)).where(eq(fraudCases.repId, repId)).orderBy(desc(fraudCaseEvents.createdAt)).limit(120),
  ]);
  const caseIds = caseRows.map((fraudCase) => fraudCase.id);
  return {
    cases: caseRows,
    holds: holds.map((row) => row.hold).filter((hold) => caseIds.includes(hold.caseId)),
    events: events.map((row) => row.event).filter((event) => caseIds.includes(event.caseId)),
  };
}
