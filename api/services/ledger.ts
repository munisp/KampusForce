import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  auditLogs,
  campusLeadAssignments,
  campusLeadOverrides,
  commissionRules,
  dealStateHistory,
  deals,
  escrowWallets,
  ledgerEntries,
  payoutAttempts,
  payouts,
  reconciliationRuns,
  reps,
  users,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { randomReference } from "./security";
import { withholdingKobo } from "./money";
import { calculateLeadOverride } from "./overrides";
import { notifyUser } from "./notifications";
import { assertNoFraudHold, blockingFraudHold } from "./fraud";
import {
  assessReconciliation,
  MAX_PAYOUT_ATTEMPTS,
  payoutProviderForAttempt,
  retryDelayMinutes,
} from "./payoutPolicy";

const db = () => getDb();
type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type LedgerClient = Database | Transaction;

async function stateChange(tx: Transaction, dealId: number, fromState: string | null, toState: NonNullable<typeof deals.$inferInsert.state>, actor: string, reason?: string) {
  await tx.update(deals).set({ state: toState, updatedAt: new Date() }).where(eq(deals.id, dealId));
  await tx.insert(dealStateHistory).values({ dealId, fromState, toState, actor, reason });
}

async function accrueCampusLeadOverride(tx: Transaction, deal: typeof deals.$inferSelect, group: string) {
  const [assignment] = await tx.select({ assignment: campusLeadAssignments, lead: reps }).from(campusLeadAssignments)
    .innerJoin(reps, eq(campusLeadAssignments.leadRepId, reps.id))
    .where(and(eq(campusLeadAssignments.repId, deal.repId), isNull(campusLeadAssignments.revokedAt), eq(reps.tier, "campus_lead"), eq(reps.status, "active")))
    .limit(1);
  if (!assignment || assignment.lead.id === deal.repId) return null;
  const economics = calculateLeadOverride(deal.repCommissionKobo, deal.platformFeeKobo);
  const [{ id }] = await tx.insert(campusLeadOverrides).values({
    dealId: deal.id,
    leadRepId: assignment.lead.id,
    sourceRepId: deal.repId,
    campusId: assignment.assignment.campusId,
    state: "accrued",
    ...economics,
  }).returning({ id: campusLeadOverrides.id });
  await tx.insert(ledgerEntries).values([
    { dealId: deal.id, account: "platform_revenue", direction: "debit", amountKobo: economics.overrideKobo, entryGroup: group },
    { dealId: deal.id, account: "lead_override_payable", direction: "credit", amountKobo: economics.overrideKobo, entryGroup: group },
  ]);
  return { overrideId: id, leadRepId: assignment.lead.id, ...economics };
}

export async function confirmDueDeals(actorUserId?: number) {
  const due = await db().select().from(deals).where(and(eq(deals.state, "pending"), lte(deals.confirmAt, new Date())));
  let confirmed = 0;
  let queuedForEscrow = 0;
  let overridesAccrued = 0;
  for (const deal of due) {
    const changed = await db().transaction(async (tx) => {
      const [current] = await tx.select().from(deals).where(eq(deals.id, deal.id)).limit(1).for("update");
      if (!current || current.state !== "pending") return false;
      const [wallet] = await tx.select().from(escrowWallets).where(eq(escrowWallets.vendorId, current.vendorId)).limit(1).for("update");
      if (!wallet || wallet.balanceKobo < current.vendorCommissionKobo) return false;
      const [rule] = current.commissionRuleId
        ? await tx.select().from(commissionRules).where(eq(commissionRules.id, current.commissionRuleId)).limit(1)
        : await tx.select().from(commissionRules).where(eq(commissionRules.productId, current.productId)).orderBy(desc(commissionRules.version)).limit(1);
      await tx.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo - current.vendorCommissionKobo, updatedAt: new Date() }).where(eq(escrowWallets.vendorId, current.vendorId));
      const group = randomReference("confirm");
      await tx.insert(ledgerEntries).values([
        { dealId: current.id, account: "vendor_escrow", direction: "debit", amountKobo: current.vendorCommissionKobo, entryGroup: group },
        { dealId: current.id, account: "rep_payable", direction: "credit", amountKobo: current.repCommissionKobo, entryGroup: group },
        { dealId: current.id, account: "platform_revenue", direction: "credit", amountKobo: current.platformFeeKobo, entryGroup: group },
      ]);
      const override = await accrueCampusLeadOverride(tx, current, group);
      if (override) overridesAccrued += 1;
      const clawbackUntil = rule ? new Date(Date.now() + rule.clawbackDays * 86_400_000) : null;
      await tx.update(deals).set({ clawbackUntil, updatedAt: new Date() }).where(eq(deals.id, current.id));
      await stateChange(tx, current.id, "pending", "confirmed", actorUserId ? `staff:${actorUserId}` : "system:confirmation", "Refund-free window elapsed; escrow reserved");
      await stateChange(tx, current.id, "confirmed", "payable", actorUserId ? `staff:${actorUserId}` : "system:confirmation", override ? `Eligible for payout; ₦${override.overrideKobo / 100} lead override funded from platform margin` : "Eligible for the next payout batch");
      return true;
    });
    if (changed) confirmed += 1;
    else queuedForEscrow += 1;
  }
  if (actorUserId) {
    await db().insert(auditLogs).values({ actorUserId, action: "payout.confirmation_sweep", entityType: "deal_batch", entityId: randomReference("sweep"), metadataJson: { confirmed, queuedForEscrow, overridesAccrued } });
  }
  return { due: due.length, confirmed, queuedForEscrow, overridesAccrued };
}

export async function reverseDeal(dealId: number, actor = "vendor:refund") {
  return db().transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1).for("update");
    if (!deal || ["void", "clawed_back"].includes(deal.state) || !["pending", "confirmed", "payable", "paid"].includes(deal.state)) return { reversed: false };
    if (deal.state !== "pending") {
      const [wallet] = await tx.select().from(escrowWallets).where(eq(escrowWallets.vendorId, deal.vendorId)).limit(1).for("update");
      if (wallet) await tx.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + deal.vendorCommissionKobo, updatedAt: new Date() }).where(eq(escrowWallets.vendorId, deal.vendorId));
      const group = randomReference("reverse");
      await tx.insert(ledgerEntries).values([
        { dealId: deal.id, account: "rep_payable", direction: "debit", amountKobo: deal.repCommissionKobo, entryGroup: group },
        { dealId: deal.id, account: "platform_revenue", direction: "debit", amountKobo: deal.platformFeeKobo, entryGroup: group },
        { dealId: deal.id, account: "vendor_escrow", direction: "credit", amountKobo: deal.vendorCommissionKobo, entryGroup: group },
      ]);
      const [override] = await tx.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.dealId, deal.id)).limit(1).for("update");
      if (override && override.state !== "reversed") {
        await tx.insert(ledgerEntries).values([
          { dealId: deal.id, account: "lead_override_payable", direction: "debit", amountKobo: override.overrideKobo, entryGroup: group },
          { dealId: deal.id, account: "platform_revenue", direction: "credit", amountKobo: override.overrideKobo, entryGroup: group },
        ]);
        await tx.update(campusLeadOverrides).set({ state: "reversed", reversedAt: new Date() }).where(eq(campusLeadOverrides.id, override.id));
      }
    }
    await stateChange(tx, deal.id, deal.state, deal.state === "paid" ? "clawed_back" : "void", actor, deal.state === "paid" ? "Refund inside clawback window; negative balances net future payouts, including paid lead overrides" : "Refund before payout; commission and any lead override reversed");
    return { reversed: true };
  });
}

async function repOutstandingKobo(repId: number, client: LedgerClient = db()): Promise<number> {
  const entries: { amount: number; direction: string }[] = await client
    .select({ amount: ledgerEntries.amountKobo, direction: ledgerEntries.direction })
    .from(ledgerEntries)
    .leftJoin(deals, eq(ledgerEntries.dealId, deals.id))
    .leftJoin(payouts, eq(ledgerEntries.payoutId, payouts.id))
    .where(and(eq(ledgerEntries.account, "rep_payable"), or(eq(deals.repId, repId), eq(payouts.repId, repId))));
  return entries.reduce((total, entry) => total + (entry.direction === "credit" ? entry.amount : -entry.amount), 0);
}

async function leadOverrideOutstandingKobo(leadRepId: number, client: LedgerClient = db()): Promise<number> {
  const entries: { amount: number; direction: string }[] = await client
    .select({ amount: ledgerEntries.amountKobo, direction: ledgerEntries.direction })
    .from(ledgerEntries)
    .leftJoin(campusLeadOverrides, eq(ledgerEntries.dealId, campusLeadOverrides.dealId))
    .leftJoin(payouts, eq(ledgerEntries.payoutId, payouts.id))
    .where(and(eq(ledgerEntries.account, "lead_override_payable"), or(eq(campusLeadOverrides.leadRepId, leadRepId), eq(payouts.repId, leadRepId))));
  return entries.reduce((total, entry) => total + (entry.direction === "credit" ? entry.amount : -entry.amount), 0);
}

export async function runPayoutBatch(actorUserId?: number) {
  const payable = await db().select().from(deals).where(and(eq(deals.state, "payable"), isNull(deals.payoutId)));
  const accruedOverrides = await db().select().from(campusLeadOverrides).where(and(eq(campusLeadOverrides.state, "accrued"), isNull(campusLeadOverrides.payoutId)));
  const repIds = [...new Set([...payable.map((deal) => deal.repId), ...accruedOverrides.map((override) => override.leadRepId)])];
  const results: { repId: number; status: string; grossKobo?: number; netKobo?: number; overrideKobo?: number; payoutId?: number; reason?: string }[] = [];
  const batchId = `KF-${new Date().toISOString().slice(0, 10)}-${randomReference("batch").slice(-8)}`;
  for (const repId of repIds) {
    const queued = await db().transaction(async (tx) => {
      // The rep lock and null payout links prevent two batches reserving the
      // same entitlement. Money and paid states move only on success below.
      const [rep] = await tx.select().from(reps).where(eq(reps.id, repId)).limit(1).for("update");
      const [user] = rep ? await tx.select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];
      if (!rep || !user || rep.status !== "active" || user.kycState !== "verified" || !user.bankNameMatch) {
        return { repId, status: "held", reason: "KYC, rep status, or bank name-match pre-flight failed" };
      }
      const fraudHold = await blockingFraudHold(tx, repId);
      if (fraudHold) {
        return { repId, status: "held", reason: `Fraud case ${fraudHold.fraudCase.caseRef} has a ${fraudHold.hold.state} payout hold` };
      }
      const entitledDeals = await tx.select().from(deals)
        .where(and(eq(deals.repId, repId), eq(deals.state, "payable"), isNull(deals.payoutId))).for("update");
      const entitledOverrides = await tx.select().from(campusLeadOverrides)
        .where(and(eq(campusLeadOverrides.leadRepId, repId), eq(campusLeadOverrides.state, "accrued"), isNull(campusLeadOverrides.payoutId))).for("update");
      const directGross = entitledDeals.reduce((total, deal) => total + deal.repCommissionKobo, 0);
      const overrideGross = entitledOverrides.reduce((total, override) => total + override.overrideKobo, 0);
      const gross = directGross + overrideGross;
      const directOutstanding = await repOutstandingKobo(repId, tx);
      const overrideOutstanding = await leadOverrideOutstandingKobo(repId, tx);
      const adjustedGross = Math.min(gross, Math.max(0, directOutstanding + overrideOutstanding));
      if (adjustedGross < 50_000) {
        return { repId, status: "rolled", grossKobo: adjustedGross, overrideKobo: overrideGross, reason: "Below ₦500 minimum after clawback netting" };
      }
      const tax = withholdingKobo(adjustedGross);
      const net = adjustedGross - tax;
      const [payout] = await tx.insert(payouts).values({
        repId,
        amountGrossKobo: adjustedGross,
        amountNetKobo: net,
        withholdingKobo: tax,
        provider: "paystack_sandbox",
        providerRef: randomReference("payout_batch"),
        state: "queued",
        batchId,
        attempts: 0,
      }).returning({ id: payouts.id });
      for (const deal of entitledDeals) {
        await tx.update(deals).set({ payoutId: payout.id, updatedAt: new Date() }).where(eq(deals.id, deal.id));
      }
      for (const override of entitledOverrides) {
        await tx.update(campusLeadOverrides).set({ payoutId: payout.id }).where(eq(campusLeadOverrides.id, override.id));
      }
      await tx.insert(auditLogs).values({
        actorUserId: actorUserId || null,
        action: "payout.batch_queued",
        entityType: "payout",
        entityId: String(payout.id),
        metadataJson: { batchId, adjustedGross, net, tax, directGross, overrideGross, dealCount: entitledDeals.length, overrideCount: entitledOverrides.length, concurrencyControl: "rep_row_lock_and_payout_links" },
      });
      return { repId, status: "queued", grossKobo: adjustedGross, netKobo: net, overrideKobo: overrideGross, payoutId: payout.id };
    });
    results.push(queued);
  }
  return { eligibleDeals: payable.length, eligibleOverrides: accruedOverrides.length, results };
}

export async function dispatchDuePayouts(actorUserId?: number) {
  const due = await db().select({ id: payouts.id }).from(payouts)
    .where(and(eq(payouts.state, "queued"), or(isNull(payouts.nextRetryAt), lte(payouts.nextRetryAt, new Date()))))
    .orderBy(payouts.createdAt).limit(100);
  const results = [];
  for (const payout of due) {
    const result = await db().transaction(async (tx) => {
      const [current] = await tx.select().from(payouts).where(eq(payouts.id, payout.id)).limit(1).for("update");
      if (!current || current.state !== "queued" || (current.nextRetryAt && current.nextRetryAt > new Date())) {
        return { payoutId: payout.id, status: "skipped" as const };
      }
      try {
        await assertNoFraudHold(tx, current.repId);
      } catch (error) {
        return { payoutId: current.id, status: "fraud_hold" as const, reason: error instanceof Error ? error.message : "Fraud hold blocks payout dispatch" };
      }
      const attemptNo = current.attempts + 1;
      if (attemptNo > MAX_PAYOUT_ATTEMPTS) {
        await tx.update(payouts).set({ state: "failed", updatedAt: new Date() }).where(eq(payouts.id, current.id));
        return { payoutId: payout.id, status: "failed" as const, reason: "Retry limit exhausted" };
      }
      const provider = payoutProviderForAttempt(attemptNo);
      const providerRef = randomReference("sandbox_transfer");
      const [attempt] = await tx.insert(payoutAttempts).values({
        payoutId: current.id,
        attemptNo,
        provider,
        providerRef,
        state: "initiated",
      }).returning({ id: payoutAttempts.id });
      await tx.update(payouts).set({ state: "processing", attempts: attemptNo, provider, updatedAt: new Date() }).where(eq(payouts.id, current.id));
      await tx.insert(auditLogs).values({
        actorUserId: actorUserId || null,
        action: "payout.attempt_initiated",
        entityType: "payout",
        entityId: String(current.id),
        metadataJson: { attemptId: attempt.id, attemptNo, provider, providerRef, mode: "sandbox_only", liveTransferInitiated: false },
      });
      return { payoutId: current.id, attemptId: attempt.id, attemptNo, provider, providerRef, status: "processing" as const, mode: "sandbox_only" as const };
    });
    results.push(result);
  }
  return { due: due.length, dispatched: results.filter((result) => result.status === "processing").length, results };
}

export async function recordSandboxPayoutOutcome(input: {
  payoutId: number;
  outcome: "success" | "failure";
  actorUserId: number;
  failureCode?: string;
}) {
  const outcome = await db().transaction(async (tx) => {
    const [payout] = await tx.select().from(payouts).where(eq(payouts.id, input.payoutId)).limit(1).for("update");
    if (!payout) throw new Error("Payout not found");
    if (payout.state === "paid" && input.outcome === "success") {
      return { payoutId: payout.id, status: "paid" as const, idempotent: true };
    }
    const [attempt] = await tx.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payout.id))
      .orderBy(desc(payoutAttempts.attemptNo)).limit(1).for("update");
    if (payout.state !== "processing" || !attempt || attempt.state !== "initiated") {
      throw new Error("Payout has no initiated attempt awaiting an outcome");
    }
    const [rep] = await tx.select().from(reps).where(eq(reps.id, payout.repId)).limit(1);
    const [user] = rep ? await tx.select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];

    if (input.outcome === "failure") {
      const failureCode = input.failureCode?.trim().slice(0, 120) || "sandbox_declined";
      const exhausted = payout.attempts >= MAX_PAYOUT_ATTEMPTS;
      const retryAt = exhausted ? null : new Date(Date.now() + retryDelayMinutes(payout.attempts) * 60_000);
      await tx.update(payoutAttempts).set({ state: "failed", failureCode, completedAt: new Date() }).where(eq(payoutAttempts.id, attempt.id));
      await tx.update(payouts).set({
        state: exhausted ? "failed" : "queued",
        nextRetryAt: retryAt,
        lastFailureCode: failureCode,
        updatedAt: new Date(),
      }).where(eq(payouts.id, payout.id));
      await tx.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: exhausted ? "payout.retries_exhausted" : "payout.retry_scheduled",
        entityType: "payout",
        entityId: String(payout.id),
        metadataJson: { attemptId: attempt.id, attemptNo: attempt.attemptNo, provider: attempt.provider, failureCode, nextRetryAt: retryAt, financeFlagged: exhausted, mode: "sandbox_only" },
      });
      return { payoutId: payout.id, status: exhausted ? "failed" as const : "queued" as const, attempts: payout.attempts, nextRetryAt: retryAt, financeFlagged: exhausted, userId: user?.id };
    }

    const entitledDeals = await tx.select().from(deals).where(eq(deals.payoutId, payout.id)).for("update");
    const entitledOverrides = await tx.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.payoutId, payout.id)).for("update");
    const directOutstanding = await repOutstandingKobo(payout.repId, tx);
    const overrideOutstanding = await leadOverrideOutstandingKobo(payout.repId, tx);
    const fraudHold = await blockingFraudHold(tx, payout.repId);
    const valid = !fraudHold && rep?.status === "active" && user?.kycState === "verified" && user.bankNameMatch
      && entitledDeals.every((deal) => deal.state === "payable")
      && entitledOverrides.every((override) => override.state === "accrued")
      && directOutstanding + overrideOutstanding >= payout.amountGrossKobo;
    if (!valid) {
      await tx.update(payoutAttempts).set({ state: "succeeded", completedAt: new Date() }).where(eq(payoutAttempts.id, attempt.id));
      await tx.update(payouts).set({ state: "held", lastFailureCode: fraudHold ? "fraud_hold" : "settlement_preflight_changed", nextRetryAt: null, updatedAt: new Date() }).where(eq(payouts.id, payout.id));
      await tx.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: "payout.settlement_held",
        entityType: "payout",
        entityId: String(payout.id),
        metadataJson: { attemptId: attempt.id, reason: fraudHold ? `Fraud case ${fraudHold.fraudCase.caseRef} blocks settlement` : "Linked entitlement or outstanding balance changed before settlement", liveTransferImplied: false },
      });
      return { payoutId: payout.id, status: "held" as const, userId: user?.id };
    }

    const group = randomReference("payout");
    const directDebit = Math.min(Math.max(0, directOutstanding), payout.amountGrossKobo);
    const overrideDebit = payout.amountGrossKobo - directDebit;
    const entries: (typeof ledgerEntries.$inferInsert)[] = [
      { payoutId: payout.id, account: "external_bank", direction: "credit", amountKobo: payout.amountNetKobo, entryGroup: group },
      { payoutId: payout.id, account: "withholding_tax", direction: "credit", amountKobo: payout.withholdingKobo, entryGroup: group },
    ];
    if (directDebit) entries.push({ payoutId: payout.id, account: "rep_payable", direction: "debit", amountKobo: directDebit, entryGroup: group });
    if (overrideDebit) entries.push({ payoutId: payout.id, account: "lead_override_payable", direction: "debit", amountKobo: overrideDebit, entryGroup: group });
    await tx.insert(ledgerEntries).values(entries);
    for (const deal of entitledDeals) {
      await stateChange(tx, deal.id, "payable", "paid", `staff:${input.actorUserId}`, `Sandbox provider success ${attempt.providerRef}; no live bank transfer implied`);
    }
    for (const override of entitledOverrides) {
      await tx.update(campusLeadOverrides).set({ state: "paid" }).where(eq(campusLeadOverrides.id, override.id));
    }
    await tx.update(payoutAttempts).set({ state: "succeeded", completedAt: new Date() }).where(eq(payoutAttempts.id, attempt.id));
    await tx.update(payouts).set({ state: "paid", paidAt: new Date(), nextRetryAt: null, lastFailureCode: null, updatedAt: new Date() }).where(eq(payouts.id, payout.id));
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "payout.batch_completed",
      entityType: "payout",
      entityId: String(payout.id),
      metadataJson: { attemptId: attempt.id, provider: attempt.provider, providerRef: attempt.providerRef, adjustedGross: payout.amountGrossKobo, net: payout.amountNetKobo, tax: payout.withholdingKobo, directDebit, overrideDebit, mode: "sandbox_only" },
    });
    return { payoutId: payout.id, status: "paid" as const, netKobo: payout.amountNetKobo, userId: user?.id, idempotent: false };
  });

  if (outcome.userId && !("idempotent" in outcome && outcome.idempotent)) {
    const paid = outcome.status === "paid";
    await notifyUser({
      userId: outcome.userId,
      type: paid ? "payout_paid" : outcome.status === "held" ? "payout_held" : "payout_delayed",
      title: paid ? "Sandbox payout completed" : outcome.status === "held" ? "Sandbox payout held" : "Sandbox payout delayed",
      body: paid
        ? `Your sandbox payout of ₦${((outcome.netKobo || 0) / 100).toLocaleString("en-NG")} was recorded. No live bank transfer is implied.`
        : "The sandbox payout requires Operations review or a retry. No live bank transfer is implied.",
      href: "/rep/earnings",
      entityType: "payout",
      entityId: outcome.payoutId,
    });
  }
  return outcome;
}

export async function recoverFailedPayout(payoutId: number, actorUserId: number) {
  return db().transaction(async (tx) => {
    const [failed] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1).for("update");
    if (!failed || failed.state !== "failed") throw new Error("Only a terminally failed payout can be recovered");
    const [rep] = await tx.select().from(reps).where(eq(reps.id, failed.repId)).limit(1).for("update");
    const [user] = rep ? await tx.select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];
    if (!rep || !user || rep.status !== "active" || user.kycState !== "verified" || !user.bankNameMatch) {
      throw new Error("Rep KYC, status, or bank name-match pre-flight no longer passes");
    }
    await assertNoFraudHold(tx, failed.repId);
    const linkedDeals = await tx.select().from(deals).where(eq(deals.payoutId, failed.id)).for("update");
    const linkedOverrides = await tx.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.payoutId, failed.id)).for("update");
    const directOutstanding = await repOutstandingKobo(failed.repId, tx);
    const overrideOutstanding = await leadOverrideOutstandingKobo(failed.repId, tx);
    if (linkedDeals.some((deal) => deal.state !== "payable") || linkedOverrides.some((override) => override.state !== "accrued")
      || directOutstanding + overrideOutstanding < failed.amountGrossKobo) {
      throw new Error("Linked entitlements or outstanding balances changed; hold for Finance review");
    }
    const [replacement] = await tx.insert(payouts).values({
      repId: failed.repId,
      amountGrossKobo: failed.amountGrossKobo,
      amountNetKobo: failed.amountNetKobo,
      withholdingKobo: failed.withholdingKobo,
      provider: "paystack_sandbox",
      providerRef: randomReference("payout_recovery"),
      state: "queued",
      batchId: failed.batchId,
      attempts: 0,
    }).returning({ id: payouts.id });
    await tx.update(deals).set({ payoutId: replacement.id, updatedAt: new Date() }).where(eq(deals.payoutId, failed.id));
    await tx.update(campusLeadOverrides).set({ payoutId: replacement.id }).where(eq(campusLeadOverrides.payoutId, failed.id));
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "payout.finance_recovery_queued",
      entityType: "payout",
      entityId: String(replacement.id),
      metadataJson: { replacesFailedPayoutId: failed.id, batchId: failed.batchId, preservedFailureHistory: true, automaticRetryLimit: MAX_PAYOUT_ATTEMPTS, mode: "sandbox_only" },
    });
    return { payoutId: replacement.id, replacesFailedPayoutId: failed.id, status: "queued" as const };
  });
}

export async function reconcilePayoutBatch(input: { batchId: string; bankNetKobo: number; actorUserId: number }) {
  const batchPayouts = await db().select().from(payouts).where(and(eq(payouts.batchId, input.batchId), eq(payouts.state, "paid")));
  if (!batchPayouts.length) throw new Error("No paid payouts exist in this batch");
  const payoutIds = batchPayouts.map((payout) => payout.id);
  const [ledgerRows, providerRows] = await Promise.all([
    db().select().from(ledgerEntries).where(and(inArray(ledgerEntries.payoutId, payoutIds), eq(ledgerEntries.account, "external_bank"), eq(ledgerEntries.direction, "credit"))),
    db().select().from(payoutAttempts).where(and(inArray(payoutAttempts.payoutId, payoutIds), eq(payoutAttempts.state, "succeeded"))),
  ]);
  const ledgerKobo = ledgerRows.reduce((sum, entry) => sum + entry.amountKobo, 0);
  const successfulIds = new Set(providerRows.map((attempt) => attempt.payoutId));
  const providerKobo = batchPayouts.filter((payout) => successfulIds.has(payout.id)).reduce((sum, payout) => sum + payout.amountNetKobo, 0);
  const assessment = assessReconciliation({
    complete: successfulIds.size === batchPayouts.length,
    ledgerKobo,
    providerKobo,
    bankKobo: input.bankNetKobo,
  });
  const [report] = await db().insert(reconciliationRuns).values({
    batchId: input.batchId,
    actorUserId: input.actorUserId,
    ledgerKobo,
    providerKobo,
    bankKobo: input.bankNetKobo,
    varianceKobo: assessment.varianceKobo,
    state: assessment.state,
    evidence: "sandbox_records_and_supplied_bank_figure",
  }).returning({ id: reconciliationRuns.id });
  await db().insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: "reconciliation.batch_recorded",
    entityType: "payout_batch",
    entityId: input.batchId,
    metadataJson: { reconciliationRunId: report.id, ledgerKobo, providerKobo, bankKobo: input.bankNetKobo, ...assessment, toleranceKobo: 100000, evidence: "sandbox_only" },
  });
  return { id: report.id, batchId: input.batchId, ledgerKobo, providerKobo, bankKobo: input.bankNetKobo, ...assessment, evidence: "sandbox_only" as const };
}
