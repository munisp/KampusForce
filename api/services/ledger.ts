import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import {
  auditLogs,
  campusLeadAssignments,
  campusLeadOverrides,
  commissionRules,
  dealStateHistory,
  deals,
  escrowWallets,
  ledgerEntries,
  payouts,
  reps,
  users,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { randomReference } from "./security";
import { withholdingKobo } from "./money";
import { calculateLeadOverride } from "./overrides";
import { notifyUser } from "./notifications";

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

export async function runPayoutBatch(actorUserId: number) {
  const payable = await db().select().from(deals).where(eq(deals.state, "payable"));
  const accruedOverrides = await db().select().from(campusLeadOverrides).where(eq(campusLeadOverrides.state, "accrued"));
  const repIds = [...new Set([...payable.map((deal) => deal.repId), ...accruedOverrides.map((override) => override.leadRepId)])];
  const results: { repId: number; status: string; grossKobo?: number; netKobo?: number; overrideKobo?: number; reason?: string }[] = [];
  for (const repId of repIds) {
    const completed = await db().transaction(async (tx) => {
      // The rep lock serializes payout batches for this recipient. All eligible
      // rows and balance calculations are re-read after the lock is acquired.
      const [rep] = await tx.select().from(reps).where(eq(reps.id, repId)).limit(1).for("update");
      const [user] = rep ? await tx.select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];
      if (!rep || !user || rep.status !== "active" || user.kycState !== "verified" || !user.bankNameMatch) {
        return { repId, status: "held", reason: "KYC, rep status, or bank name-match pre-flight failed" };
      }
      const entitledDeals = await tx.select().from(deals).where(and(eq(deals.repId, repId), eq(deals.state, "payable"))).for("update");
      const entitledOverrides = await tx.select().from(campusLeadOverrides).where(and(eq(campusLeadOverrides.leadRepId, repId), eq(campusLeadOverrides.state, "accrued"))).for("update");
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
      const batchId = `KF-${new Date().toISOString().slice(0, 10)}-${randomReference("batch").slice(-8)}`;
      const providerRef = randomReference("sandbox_paystack");
      const [payout] = await tx.insert(payouts).values({ repId, amountGrossKobo: adjustedGross, amountNetKobo: net, withholdingKobo: tax, provider: "paystack_sandbox", providerRef, state: "paid", batchId, attempts: 1, paidAt: new Date() }).returning({ id: payouts.id });
      const group = randomReference("payout");
      const directDebit = Math.min(Math.max(0, directOutstanding), adjustedGross);
      const overrideDebit = adjustedGross - directDebit;
      const entries: (typeof ledgerEntries.$inferInsert)[] = [
        { payoutId: payout.id, account: "external_bank", direction: "credit", amountKobo: net, entryGroup: group },
        { payoutId: payout.id, account: "withholding_tax", direction: "credit", amountKobo: tax, entryGroup: group },
      ];
      if (directDebit) entries.push({ payoutId: payout.id, account: "rep_payable", direction: "debit", amountKobo: directDebit, entryGroup: group });
      if (overrideDebit) entries.push({ payoutId: payout.id, account: "lead_override_payable", direction: "debit", amountKobo: overrideDebit, entryGroup: group });
      await tx.insert(ledgerEntries).values(entries);
      for (const deal of entitledDeals) await stateChange(tx, deal.id, "payable", "paid", `staff:${actorUserId}`, `Sandbox transfer ${providerRef}`);
      for (const override of entitledOverrides) await tx.update(campusLeadOverrides).set({ state: "paid", payoutId: payout.id }).where(eq(campusLeadOverrides.id, override.id));
      await tx.insert(auditLogs).values({ actorUserId, action: "payout.batch_completed", entityType: "payout", entityId: String(payout.id), metadataJson: { provider: "paystack_sandbox", adjustedGross, net, tax, directGross, overrideGross, directDebit, overrideDebit, concurrencyControl: "rep_row_lock" } });
      return { repId, status: "paid", grossKobo: adjustedGross, netKobo: net, overrideKobo: overrideGross, payoutId: payout.id, userId: user.id };
    });
    if (completed.status === "paid" && "userId" in completed) {
      await notifyUser({ userId: completed.userId as number, type: "payout_paid", title: "Sandbox payout completed", body: `Your sandbox payout of ₦${((completed.netKobo || 0) / 100).toLocaleString("en-NG")} was recorded. No live bank transfer is implied.`, href: "/rep/earnings", entityType: "payout", entityId: completed.payoutId as number });
    }
    results.push(completed);
  }
  return { eligibleDeals: payable.length, eligibleOverrides: accruedOverrides.length, results };
}
