import { and, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  campusLeadAssignments,
  campusLeadOverrides,
  commissionRules,
  dealStateHistory,
  deals,
  disputes,
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
import { enqueueFinancialPosting } from "./tigerBeetle";
import { notifyUser } from "./notifications";
import { assertNoFraudHold, blockingFraudHold } from "./fraud";
import { assertCurrentIdentityApproval, currentIdentityApproval } from "./identity";
import { assertCurrentStudentAssurance, studentAssurancePreflight } from "./studentAssurance";
import { signalPromotionActivationConfirmed } from "./promotionSignals";
import { signalActivationEvidence } from "./platformInnovations";
import {
  assessReconciliation,
  MAX_PAYOUT_ATTEMPTS,
  payoutProviderForAttempt,
  retryDelayMinutes,
} from "./payoutPolicy";
import { integrationConfiguration } from "./integrationConfig";
import { assertLiveProviderExecutionAuthorized } from "./launchReadiness";
import { initiateLiveProviderPayout, ProviderPayoutError, type ProviderPayoutInput } from "./payoutProviders";
import { resolvePayoutDestination } from "./payoutDestinations";

const db = () => getDb();
const payoutExecutionMode = () => integrationConfiguration().requestedMode === "live" ? "live" as const : "sandbox" as const;
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
      await enqueueFinancialPosting(tx, {
        entryGroup: group,
        operation: "activation_confirmation",
        accountRefs: {
          vendor_escrow: `vendor:${current.vendorId}`,
          rep_payable: `rep:${current.repId}`,
          platform_revenue: "platform",
          ...(override ? { lead_override_payable: `rep:${override.leadRepId}` } : {}),
        },
      });
      const clawbackUntil = rule ? new Date(Date.now() + rule.clawbackDays * 86_400_000) : null;
      await tx.update(deals).set({ clawbackUntil, updatedAt: new Date() }).where(eq(deals.id, current.id));
      await stateChange(tx, current.id, "pending", "confirmed", actorUserId ? `staff:${actorUserId}` : "system:confirmation", "Refund-free window elapsed; escrow reserved");
      await stateChange(tx, current.id, "confirmed", "payable", actorUserId ? `staff:${actorUserId}` : "system:confirmation", override ? `Eligible for payout; ₦${override.overrideKobo / 100} lead override funded from platform margin` : "Eligible for the next payout batch");
      await signalPromotionActivationConfirmed(current.id, actorUserId, tx);
      await signalActivationEvidence(current.id, "ledger.confirmation", `deal:${current.id};state:payable;commission-rule:${current.commissionRuleId || "unversioned"}`, new Date(), tx);
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

async function reverseDealLocked(tx: Transaction, dealId: number, actor: string) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1).for("update");
  if (!deal) throw new Error("Deal not found");
  let effectiveState = deal.state;
  let activeDispute: typeof disputes.$inferSelect | undefined;
  if (deal.state === "disputed") {
    [activeDispute] = await tx.select().from(disputes).where(and(
      eq(disputes.dealId, deal.id),
      inArray(disputes.state, ["open", "reviewing"]),
    )).orderBy(desc(disputes.createdAt)).limit(1).for("update");
    if (!activeDispute?.previousDealState) {
      throw new TRPCError({ code: "CONFLICT", message: "This legacy dispute has no preserved deal state and requires manual financial review" });
    }
    effectiveState = activeDispute.previousDealState;
  }
  if (!["pending", "confirmed", "payable", "paid"].includes(effectiveState)) return { state: deal.state, reversed: false };
  const target = effectiveState === "paid" ? "clawed_back" : "void";
  if (effectiveState !== "pending") {
    const [wallet] = await tx.select().from(escrowWallets).where(eq(escrowWallets.vendorId, deal.vendorId)).limit(1).for("update");
    if (!wallet) throw new Error("Vendor escrow wallet missing");
    await tx.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + deal.vendorCommissionKobo, updatedAt: new Date() }).where(eq(escrowWallets.vendorId, deal.vendorId));
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
    await enqueueFinancialPosting(tx, {
      entryGroup: group,
      operation: "activation_reversal",
      accountRefs: {
        vendor_escrow: `vendor:${deal.vendorId}`,
        rep_payable: `rep:${deal.repId}`,
        platform_revenue: "platform",
        ...(override ? { lead_override_payable: `rep:${override.leadRepId}` } : {}),
      },
    });
  }
  if (activeDispute) {
    await tx.update(disputes).set({
      state: "rejected",
      decision: "Vendor refund received during dispute; the prior financial entitlement was reversed.",
      decidedAt: new Date(),
    }).where(eq(disputes.id, activeDispute.id));
  }
  await stateChange(tx, deal.id, deal.state, target, actor, activeDispute ? "Vendor refund during dispute; prior entitlement reversed" : effectiveState === "paid" ? "Refund inside clawback window; negative balances net future payouts, including paid lead overrides" : "Refund before payout; commission and any lead override reversed");
  return { state: target, reversed: true };
}

export async function reverseDeal(dealId: number, actor = "vendor:refund") {
  return db().transaction((tx) => reverseDealLocked(tx, dealId, actor));
}

export async function openDealDispute(input: { dealId: number; repId: number; actorUserId: number; reasonCode: string; evidence?: string }) {
  return db().transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.repId, input.repId))).limit(1).for("update");
    if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
    if (!["pending", "confirmed", "payable", "paid"].includes(deal.state)) {
      throw new TRPCError({ code: "CONFLICT", message: "Only a pending or financially active deal can be disputed" });
    }
    const [existing] = await tx.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.dealId, deal.id), inArray(disputes.state, ["open", "reviewing"]))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This deal already has an open dispute" });
    const [dispute] = await tx.insert(disputes).values({
      dealId: deal.id,
      openedBy: input.actorUserId,
      reasonCode: input.reasonCode,
      evidenceJson: { note: input.evidence || null },
      previousDealState: deal.state,
    }).returning();
    await stateChange(tx, deal.id, deal.state, "disputed", `rep:${input.repId}`, input.reasonCode);
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "dispute.opened", entityType: "dispute", entityId: String(dispute.id), metadataJson: { dealId: deal.id, previousDealState: deal.state } });
    return { disputeId: dispute.id, state: "open" as const, previousDealState: deal.state };
  });
}

export async function resolveDealDispute(input: { disputeId: number; actorUserId: number; upholdRep: boolean; decision: string }) {
  return db().transaction(async (tx) => {
    const [dispute] = await tx.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1).for("update");
    if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
    if (!["open", "reviewing"].includes(dispute.state)) throw new TRPCError({ code: "CONFLICT", message: "This dispute has already been decided" });
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dispute.dealId)).limit(1).for("update");
    if (!deal || deal.state !== "disputed" || !dispute.previousDealState) {
      throw new TRPCError({ code: "CONFLICT", message: "The dispute and deal state are inconsistent; manual financial review is required" });
    }
    const previousState = dispute.previousDealState;
    if (input.upholdRep) {
      await tx.update(disputes).set({ state: "resolved", decision: input.decision, decidedByUserId: input.actorUserId, decidedAt: new Date() }).where(eq(disputes.id, dispute.id));
      await stateChange(tx, deal.id, "disputed", previousState, `user:${input.actorUserId}`, "Dispute upheld; prior deal state restored");
      if (previousState === "confirmed") await stateChange(tx, deal.id, "confirmed", "payable", `user:${input.actorUserId}`, "Restored confirmed entitlement returned to payout eligibility");
      await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "dispute.resolved", entityType: "dispute", entityId: String(dispute.id), metadataJson: { dealId: deal.id, restoredState: previousState, payoutEligibleState: previousState === "confirmed" ? "payable" : previousState } });
      return { disputeId: dispute.id, state: "resolved" as const, dealState: previousState === "confirmed" ? "payable" : previousState, reversed: false };
    }
    if (previousState === "pending") {
      await tx.update(disputes).set({ state: "rejected", decision: input.decision, decidedByUserId: input.actorUserId, decidedAt: new Date() }).where(eq(disputes.id, dispute.id));
      await stateChange(tx, deal.id, "disputed", "void", `user:${input.actorUserId}`, "Dispute rejected before commission confirmation");
      await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "dispute.rejected", entityType: "dispute", entityId: String(dispute.id), metadataJson: { dealId: deal.id, previousState, dealState: "void" } });
      return { disputeId: dispute.id, state: "rejected" as const, dealState: "void" as const, reversed: false };
    }
    const result = await reverseDealLocked(tx, deal.id, `user:${input.actorUserId}:dispute`);
    await tx.update(disputes).set({ decision: input.decision, decidedByUserId: input.actorUserId }).where(eq(disputes.id, dispute.id));
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "dispute.rejected", entityType: "dispute", entityId: String(dispute.id), metadataJson: { dealId: deal.id, previousState, dealState: result.state } });
    return { disputeId: dispute.id, state: "rejected" as const, dealState: result.state, reversed: result.reversed };
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
      const identityApproval = user ? await currentIdentityApproval({ subjectType: "user", subjectId: user.id, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, tx) : null;
      const studentAssurance = user ? await studentAssurancePreflight(user.id, tx) : null;
      if (!rep || !user || rep.status !== "active" || user.kycState !== "verified" || !user.bankNameMatch || !identityApproval || !studentAssurance?.eligible) {
        return { repId, status: "held", reason: studentAssurance?.reason || "Current identity approval, KYC, rep status, or bank name-match pre-flight failed" };
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
        provider: payoutExecutionMode() === "live" ? "paystack" : "paystack_sandbox",
        providerRef: randomReference("payout_batch"),
        executionMode: payoutExecutionMode(),
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

const DISPATCH_RECOVERY_TIMEOUT_MS = 2 * 60_000;

/** Recover process interruptions without ever re-emitting an uncertain live transfer. */
export async function recoverInterruptedPayoutDispatches(now = new Date()) {
  const staleBefore = new Date(now.getTime() - DISPATCH_RECOVERY_TIMEOUT_MS);
  const stale = await db().select({ id: payouts.id }).from(payouts)
    .where(and(eq(payouts.state, "processing"), lt(payouts.updatedAt, staleBefore)))
    .orderBy(payouts.updatedAt).limit(100);
  const results: Array<Record<string, unknown>> = [];
  for (const candidate of stale) {
    const recovered = await db().transaction(async (tx) => {
      const [payout] = await tx.select().from(payouts).where(eq(payouts.id, candidate.id)).limit(1).for("update");
      if (!payout || payout.state !== "processing" || payout.updatedAt >= staleBefore) return null;
      const [attempt] = await tx.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payout.id))
        .orderBy(desc(payoutAttempts.attemptNo)).limit(1).for("update");
      if (!attempt || attempt.state !== "initiated" || attempt.providerAcceptedAt) return null;
      if (payout.executionMode === "live" || attempt.executionMode === "live") {
        await tx.update(payouts).set({ state: "held", lastFailureCode: "provider_outcome_unknown", nextRetryAt: null, updatedAt: now }).where(eq(payouts.id, payout.id));
        await tx.insert(auditLogs).values({
          actorUserId: null,
          action: "payout.interrupted_live_dispatch_held",
          entityType: "payout",
          entityId: String(payout.id),
          metadataJson: { attemptId: attempt.id, provider: attempt.provider, providerRef: attempt.providerRef, automaticRetryBlocked: true, verifiedLateOutcomeAccepted: true },
        });
        return { payoutId: payout.id, attemptId: attempt.id, status: "held" as const, mode: "live" as const };
      }
      const exhausted = payout.attempts >= MAX_PAYOUT_ATTEMPTS;
      await tx.update(payoutAttempts).set({ state: "failed", failureCode: "sandbox_dispatch_interrupted", completedAt: now }).where(eq(payoutAttempts.id, attempt.id));
      await tx.update(payouts).set({ state: exhausted ? "failed" : "queued", lastFailureCode: "sandbox_dispatch_interrupted", nextRetryAt: exhausted ? null : now, updatedAt: now }).where(eq(payouts.id, payout.id));
      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: "payout.interrupted_sandbox_dispatch_recovered",
        entityType: "payout",
        entityId: String(payout.id),
        metadataJson: { attemptId: attempt.id, exhausted, liveTransferImplied: false },
      });
      return { payoutId: payout.id, attemptId: attempt.id, status: exhausted ? "failed" as const : "queued" as const, mode: "sandbox" as const };
    });
    if (recovered) results.push(recovered);
  }
  return { examined: stale.length, recovered: results.length, results };
}

export async function dispatchDuePayouts(
  actorUserId?: number,
  executeProvider: typeof initiateLiveProviderPayout = initiateLiveProviderPayout,
  authorizeLive: typeof assertLiveProviderExecutionAuthorized = assertLiveProviderExecutionAuthorized,
) {
  await recoverInterruptedPayoutDispatches();
  const due = await db().select({ id: payouts.id, executionMode: payouts.executionMode }).from(payouts)
    .where(and(eq(payouts.state, "queued"), or(isNull(payouts.nextRetryAt), lte(payouts.nextRetryAt, new Date()))))
    .orderBy(payouts.createdAt).limit(100);
  const results: Array<Record<string, unknown>> = [];
  for (const payout of due) {
    if (payout.executionMode === "live") {
      try {
        await authorizeLive();
      } catch (error) {
        results.push({ payoutId: payout.id, status: "live_execution_blocked", reason: error instanceof Error ? error.message : "Live provider execution is not authorized" });
        continue;
      }
    }
    const liveRequests: Array<{ payoutId: number; attemptId: number; provider: "paystack" | "flutterwave"; providerRef: string; input: ProviderPayoutInput }> = [];
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
      const [dispatchRep] = await tx.select().from(reps).where(eq(reps.id, current.repId)).limit(1);
      const [dispatchUser] = dispatchRep ? await tx.select().from(users).where(eq(users.id, dispatchRep.userId)).limit(1) : [];
      const dispatchIdentity = dispatchUser ? await currentIdentityApproval({ subjectType: "user", subjectId: dispatchUser.id, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, tx) : null;
      const dispatchAssurance = dispatchUser ? await studentAssurancePreflight(dispatchUser.id, tx) : null;
      if (!dispatchRep || !dispatchUser || dispatchRep.status !== "active" || dispatchUser.kycState !== "verified" || !dispatchUser.bankNameMatch || !dispatchIdentity || !dispatchAssurance?.eligible) {
        return { payoutId: current.id, status: "assurance_hold" as const, reason: dispatchAssurance?.reason || "Identity or representative eligibility changed before dispatch" };
      }
      const mode = current.executionMode === "live" ? "live" as const : "sandbox" as const;
      let destination: ProviderPayoutInput | null = null;
      if (mode === "live") {
        try {
          const resolved = await resolvePayoutDestination(dispatchUser.id, tx);
          destination = { ...resolved, amountNetKobo: current.amountNetKobo, reference: "", narration: `KampusForce payout ${current.batchId}` };
        } catch (error) {
          return { payoutId: current.id, status: "destination_hold" as const, reason: error instanceof Error ? error.message : "Encrypted payout destination is unavailable" };
        }
      }
      const attemptNo = current.attempts + 1;
      if (attemptNo > MAX_PAYOUT_ATTEMPTS) {
        await tx.update(payouts).set({ state: "failed", updatedAt: new Date() }).where(eq(payouts.id, current.id));
        return { payoutId: payout.id, status: "failed" as const, reason: "Retry limit exhausted" };
      }
      const provider = mode === "live"
        ? (attemptNo === MAX_PAYOUT_ATTEMPTS ? "flutterwave" as const : "paystack" as const)
        : payoutProviderForAttempt(attemptNo);
      const providerRef = randomReference(mode === "live" ? "live_transfer" : "sandbox_transfer");
      const [attempt] = await tx.insert(payoutAttempts).values({
        payoutId: current.id,
        attemptNo,
        provider,
        providerRef,
        executionMode: mode,
        state: "initiated",
      }).returning({ id: payoutAttempts.id });
      await tx.update(payouts).set({ state: "processing", attempts: attemptNo, provider, updatedAt: new Date() }).where(eq(payouts.id, current.id));
      await tx.insert(auditLogs).values({
        actorUserId: actorUserId || null,
        action: "payout.attempt_reserved",
        entityType: "payout",
        entityId: String(current.id),
        metadataJson: { attemptId: attempt.id, attemptNo, provider, providerRef, mode, liveTransferInitiated: false },
      });
      if (destination && (provider === "paystack" || provider === "flutterwave")) {
        destination.reference = providerRef;
        liveRequests.push({ payoutId: current.id, attemptId: attempt.id, provider, providerRef, input: destination });
      }
      return { payoutId: current.id, attemptId: attempt.id, attemptNo, provider, providerRef, status: "processing" as const, mode: mode === "live" ? "live_reserved" as const : "sandbox_only" as const };
    });
    const [request] = liveRequests;
    if (!request) {
      results.push(result);
      continue;
    }
    try {
      const receipt = await executeProvider(request.provider, request.input);
      if (receipt.provider !== request.provider || receipt.providerRef !== request.providerRef || receipt.settlementEligible !== false) {
        throw new ProviderPayoutError("Provider acceptance receipt does not match the reserved attempt");
      }
      await db().transaction(async (tx) => {
        await tx.update(payoutAttempts).set({ providerAcceptedAt: new Date() }).where(and(eq(payoutAttempts.id, request.attemptId), eq(payoutAttempts.state, "initiated")));
        await tx.insert(auditLogs).values({
        actorUserId: actorUserId || null,
        action: "payout.provider_accepted",
        entityType: "payout",
        entityId: String(request.payoutId),
        metadataJson: { attemptId: request.attemptId, provider: request.provider, providerRef: request.providerRef, providerStatus: receipt.providerStatus.slice(0, 60), mode: "live", settlementEligible: false },
        });
      });
      results.push({ ...result, status: "processing", mode: "live", providerStatus: receipt.providerStatus, settlementEligible: false });
    } catch (error) {
      if (error instanceof ProviderPayoutError && error.rejected) {
        const rejected = await recordPayoutOutcome({
          payoutId: request.payoutId,
          outcome: "failure",
          actorUserId: actorUserId || null,
          failureCode: "provider_request_rejected",
          mode: "live",
          provider: request.provider,
          providerRef: request.providerRef,
          providerEventId: `dispatch-rejection:${request.attemptId}`,
          amountNetKobo: request.input.amountNetKobo,
        });
        results.push({ payoutId: request.payoutId, attemptId: request.attemptId, status: rejected.status, mode: "live", reason: error.message });
      } else {
        const reason = error instanceof Error ? error.message : "Provider outcome is unknown";
        await db().transaction(async (tx) => {
          await tx.update(payouts).set({ state: "held", lastFailureCode: "provider_outcome_unknown", nextRetryAt: null, updatedAt: new Date() }).where(eq(payouts.id, request.payoutId));
          await tx.insert(auditLogs).values({
            actorUserId: actorUserId || null,
            action: "payout.provider_outcome_unknown",
            entityType: "payout",
            entityId: String(request.payoutId),
            metadataJson: { attemptId: request.attemptId, provider: request.provider, providerRef: request.providerRef, mode: "live", automaticRetryBlocked: true, reason: reason.slice(0, 200) },
          });
        });
        results.push({ payoutId: request.payoutId, attemptId: request.attemptId, status: "held", mode: "live", reason: "Provider outcome is unknown; reconcile before any further attempt" });
      }
    }
  }
  return { due: due.length, dispatched: results.filter((result) => result.status === "processing").length, results };
}

async function recordPayoutOutcome(input: {
  payoutId: number;
  outcome: "success" | "failure";
  actorUserId: number | null;
  failureCode?: string;
  mode: "sandbox" | "live";
  provider?: "paystack" | "flutterwave";
  providerRef?: string;
  providerEventId?: string;
  amountNetKobo?: number;
}) {
  const outcome = await db().transaction(async (tx) => {
    const [payout] = await tx.select().from(payouts).where(eq(payouts.id, input.payoutId)).limit(1).for("update");
    if (!payout) throw new Error("Payout not found");
    const [attempt] = await tx.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payout.id))
      .orderBy(desc(payoutAttempts.attemptNo)).limit(1).for("update");
    if (payout.executionMode !== input.mode || (attempt && attempt.executionMode !== input.mode)) {
      throw new Error("Payout outcome mode does not match the reserved execution mode");
    }
    if (input.mode === "live") {
      if (!attempt || !input.provider || attempt.provider !== input.provider || attempt.providerRef !== input.providerRef) {
        throw new Error("Verified provider reference does not match the initiated payout attempt");
      }
      if (!Number.isSafeInteger(input.amountNetKobo) || input.amountNetKobo !== payout.amountNetKobo) {
        throw new Error("Verified provider amount does not match the payout net amount");
      }
    }
    if (payout.state === "paid" && input.outcome === "success") {
      return { payoutId: payout.id, status: "paid" as const, idempotent: true };
    }
    const reconcilingUnknownLiveOutcome = input.mode === "live" && payout.state === "held" && payout.lastFailureCode === "provider_outcome_unknown";
    if ((payout.state !== "processing" && !reconcilingUnknownLiveOutcome) || !attempt || attempt.state !== "initiated") {
      throw new Error("Payout has no initiated attempt awaiting an outcome");
    }
    const [rep] = await tx.select().from(reps).where(eq(reps.id, payout.repId)).limit(1);
    const [user] = rep ? await tx.select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];

    if (input.outcome === "failure") {
      const failureCode = input.failureCode?.trim().slice(0, 120) || (input.mode === "live" ? "provider_failed" : "sandbox_declined");
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
        metadataJson: { attemptId: attempt.id, attemptNo: attempt.attemptNo, provider: attempt.provider, failureCode, nextRetryAt: retryAt, financeFlagged: exhausted, mode: input.mode, providerEventId: input.providerEventId || null },
      });
      return { payoutId: payout.id, status: exhausted ? "failed" as const : "queued" as const, attempts: payout.attempts, nextRetryAt: retryAt, financeFlagged: exhausted, userId: user?.id };
    }

    const entitledDeals = await tx.select().from(deals).where(eq(deals.payoutId, payout.id)).for("update");
    const entitledOverrides = await tx.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.payoutId, payout.id)).for("update");
    const directOutstanding = await repOutstandingKobo(payout.repId, tx);
    const overrideOutstanding = await leadOverrideOutstandingKobo(payout.repId, tx);
    const fraudHold = await blockingFraudHold(tx, payout.repId);
    const identityApproval = user ? await currentIdentityApproval({ subjectType: "user", subjectId: user.id, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, tx) : null;
    const studentAssurance = user ? await studentAssurancePreflight(user.id, tx) : null;
    const valid = !fraudHold && rep?.status === "active" && user?.kycState === "verified" && user.bankNameMatch && !!identityApproval && !!studentAssurance?.eligible
      && entitledDeals.every((deal) => deal.state === "payable")
      && entitledOverrides.every((override) => override.state === "accrued")
      && directOutstanding + overrideOutstanding >= payout.amountGrossKobo;
    if (!valid) {
      await tx.update(payoutAttempts).set({ state: "succeeded", completedAt: new Date() }).where(eq(payoutAttempts.id, attempt.id));
      await tx.update(payouts).set({ state: "held", lastFailureCode: fraudHold ? "fraud_hold" : !identityApproval ? "identity_approval_invalid" : !studentAssurance?.eligible ? "student_assurance_invalid" : "settlement_preflight_changed", nextRetryAt: null, updatedAt: new Date() }).where(eq(payouts.id, payout.id));
      await tx.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: "payout.settlement_held",
        entityType: "payout",
        entityId: String(payout.id),
        metadataJson: { attemptId: attempt.id, reason: fraudHold ? `Fraud case ${fraudHold.fraudCase.caseRef} blocks settlement` : studentAssurance?.reason || "Linked entitlement, identity or outstanding balance changed before settlement", liveTransferImplied: false },
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
    await enqueueFinancialPosting(tx, {
      entryGroup: group,
      operation: "payout_settlement",
      accountRefs: {
        rep_payable: `rep:${payout.repId}`,
        lead_override_payable: `rep:${payout.repId}`,
        withholding_tax: "platform:withholding",
        external_bank: `payout:${payout.id}`,
      },
    });
    for (const deal of entitledDeals) {
      await stateChange(tx, deal.id, "payable", "paid", input.actorUserId ? `staff:${input.actorUserId}` : "system:provider_webhook", input.mode === "live"
        ? `Verified provider success ${attempt.providerRef}; event ${input.providerEventId || "recorded"}`
        : `Sandbox provider success ${attempt.providerRef}; no live bank transfer implied`);
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
      metadataJson: { attemptId: attempt.id, provider: attempt.provider, providerRef: attempt.providerRef, adjustedGross: payout.amountGrossKobo, net: payout.amountNetKobo, tax: payout.withholdingKobo, directDebit, overrideDebit, mode: input.mode, providerEventId: input.providerEventId || null },
    });
    return { payoutId: payout.id, status: "paid" as const, netKobo: payout.amountNetKobo, userId: user?.id, idempotent: false };
  });

  if (outcome.userId && !("idempotent" in outcome && outcome.idempotent)) {
    const paid = outcome.status === "paid";
    const live = input.mode === "live";
    await notifyUser({
      userId: outcome.userId,
      type: paid ? "payout_paid" : outcome.status === "held" ? "payout_held" : "payout_delayed",
      title: paid ? `${live ? "Payout" : "Sandbox payout"} completed` : outcome.status === "held" ? `${live ? "Payout" : "Sandbox payout"} held` : `${live ? "Payout" : "Sandbox payout"} delayed`,
      body: paid
        ? live
          ? `Your verified payout of ₦${((outcome.netKobo || 0) / 100).toLocaleString("en-NG")} was marked paid from a signed provider outcome.`
          : `Your sandbox payout of ₦${((outcome.netKobo || 0) / 100).toLocaleString("en-NG")} was recorded. No live bank transfer is implied.`
        : live
          ? "The payout requires Operations review or a provider retry. Review the attempt and reconciliation records."
          : "The sandbox payout requires Operations review or a retry. No live bank transfer is implied.",
      href: "/rep/earnings",
      entityType: "payout",
      entityId: outcome.payoutId,
    });
  }
  return outcome;
}

export async function recordSandboxPayoutOutcome(input: {
  payoutId: number;
  outcome: "success" | "failure";
  actorUserId: number;
  failureCode?: string;
}) {
  return recordPayoutOutcome({ ...input, mode: "sandbox" });
}

export async function recordVerifiedProviderPayoutOutcome(input: {
  payoutId: number;
  outcome: "success" | "failure";
  provider: "paystack" | "flutterwave";
  providerRef: string;
  providerEventId: string;
  amountNetKobo: number;
  failureCode?: string;
}) {
  return recordPayoutOutcome({ ...input, actorUserId: null, mode: "live" });
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
    await assertCurrentIdentityApproval({ subjectType: "user", subjectId: user.id, caseTypes: ["representative_kyc", "campus_lead_kyc"] }, tx);
    await assertCurrentStudentAssurance(user.id, tx);
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
      provider: failed.executionMode === "live" ? "paystack" : "paystack_sandbox",
      providerRef: randomReference("payout_recovery"),
      executionMode: failed.executionMode,
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
      metadataJson: { replacesFailedPayoutId: failed.id, batchId: failed.batchId, preservedFailureHistory: true, automaticRetryLimit: MAX_PAYOUT_ATTEMPTS, mode: failed.executionMode },
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
  const live = batchPayouts.every((payout) => payout.executionMode === "live");
  const evidence = live ? "live_records_supplied_bank_figure" : "sandbox_records_and_supplied_bank_figure";
  const [report] = await db().insert(reconciliationRuns).values({
    batchId: input.batchId,
    actorUserId: input.actorUserId,
    ledgerKobo,
    providerKobo,
    bankKobo: input.bankNetKobo,
    varianceKobo: assessment.varianceKobo,
    state: assessment.state,
    evidence,
  }).returning({ id: reconciliationRuns.id });
  await db().insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: "reconciliation.batch_recorded",
    entityType: "payout_batch",
    entityId: input.batchId,
    metadataJson: { reconciliationRunId: report.id, ledgerKobo, providerKobo, bankKobo: input.bankNetKobo, ...assessment, toleranceKobo: 100000, evidence, externalBankFigureIndependentlyVerified: false },
  });
  return { id: report.id, batchId: input.batchId, ledgerKobo, providerKobo, bankKobo: input.bankNetKobo, ...assessment, evidence, externalBankFigureIndependentlyVerified: false as const };
}
