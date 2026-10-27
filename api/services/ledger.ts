import { and, desc, eq, lte, or } from "drizzle-orm";
import {
  auditLogs,
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

const db = () => getDb();

async function stateChange(tx: any, dealId: number, fromState: string | null, toState: string, actor: string, reason?: string) {
  await tx.update(deals).set({ state: toState as any }).where(eq(deals.id, dealId));
  await tx.insert(dealStateHistory).values({ dealId, fromState, toState, actor, reason });
}

export async function confirmDueDeals(actorUserId?: number) {
  const due = await db().select().from(deals).where(and(eq(deals.state, "pending"), lte(deals.confirmAt, new Date())));
  let confirmed = 0;
  let queuedForEscrow = 0;
  for (const deal of due) {
    const [rule] = await db().select().from(commissionRules).where(eq(commissionRules.productId, deal.productId)).orderBy(desc(commissionRules.version)).limit(1);
    const changed = await db().transaction(async (tx) => {
      const [current] = await tx.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
      if (!current || current.state !== "pending") return false;
      const [wallet] = await tx.select().from(escrowWallets).where(eq(escrowWallets.vendorId, current.vendorId)).limit(1);
      if (!wallet || wallet.balanceKobo < current.vendorCommissionKobo) return false;
      await tx.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo - current.vendorCommissionKobo }).where(eq(escrowWallets.vendorId, current.vendorId));
      const group = randomReference("confirm");
      await tx.insert(ledgerEntries).values([
        { dealId: current.id, account: "vendor_escrow", direction: "debit", amountKobo: current.vendorCommissionKobo, entryGroup: group },
        { dealId: current.id, account: "rep_payable", direction: "credit", amountKobo: current.repCommissionKobo, entryGroup: group },
        { dealId: current.id, account: "platform_revenue", direction: "credit", amountKobo: current.platformFeeKobo, entryGroup: group },
      ]);
      const clawbackUntil = rule ? new Date(Date.now() + rule.clawbackDays * 86_400_000) : null;
      await tx.update(deals).set({ clawbackUntil }).where(eq(deals.id, current.id));
      await stateChange(tx, current.id, "pending", "confirmed", actorUserId ? `staff:${actorUserId}` : "system:confirmation", "Refund-free window elapsed; escrow reserved");
      await stateChange(tx, current.id, "confirmed", "payable", actorUserId ? `staff:${actorUserId}` : "system:confirmation", "Eligible for the next payout batch");
      return true;
    });
    if (changed) confirmed += 1;
    else queuedForEscrow += 1;
  }
  if (actorUserId) {
    await db().insert(auditLogs).values({ actorUserId, action: "payout.confirmation_sweep", entityType: "deal_batch", entityId: randomReference("sweep"), metadataJson: { confirmed, queuedForEscrow } });
  }
  return { due: due.length, confirmed, queuedForEscrow };
}

export async function reverseDeal(dealId: number, actor = "vendor:refund") {
  const [deal] = await db().select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal || ["void", "clawed_back"].includes(deal.state)) return { reversed: false };
  if (["pending", "confirmed", "payable", "paid"].includes(deal.state) === false) return { reversed: false };
  await db().transaction(async (tx) => {
    if (deal.state !== "pending") {
      const [wallet] = await tx.select().from(escrowWallets).where(eq(escrowWallets.vendorId, deal.vendorId)).limit(1);
      if (wallet) await tx.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + deal.vendorCommissionKobo }).where(eq(escrowWallets.vendorId, deal.vendorId));
      const group = randomReference("reverse");
      await tx.insert(ledgerEntries).values([
        { dealId: deal.id, account: "rep_payable", direction: "debit", amountKobo: deal.repCommissionKobo, entryGroup: group },
        { dealId: deal.id, account: "platform_revenue", direction: "debit", amountKobo: deal.platformFeeKobo, entryGroup: group },
        { dealId: deal.id, account: "vendor_escrow", direction: "credit", amountKobo: deal.vendorCommissionKobo, entryGroup: group },
      ]);
    }
    await stateChange(tx, deal.id, deal.state, deal.state === "paid" ? "clawed_back" : "void", actor, deal.state === "paid" ? "Refund inside clawback window; negative balance nets future payouts" : "Refund before payout; commission reversed");
  });
  return { reversed: true };
}

async function repOutstandingKobo(repId: number): Promise<number> {
  const entries = await db()
    .select({ amount: ledgerEntries.amountKobo, direction: ledgerEntries.direction })
    .from(ledgerEntries)
    .leftJoin(deals, eq(ledgerEntries.dealId, deals.id))
    .leftJoin(payouts, eq(ledgerEntries.payoutId, payouts.id))
    .where(and(eq(ledgerEntries.account, "rep_payable"), or(eq(deals.repId, repId), eq(payouts.repId, repId))));
  return entries.reduce((total, entry) => total + (entry.direction === "credit" ? entry.amount : -entry.amount), 0);
}

export async function runPayoutBatch(actorUserId: number) {
  const payable = await db().select().from(deals).where(eq(deals.state, "payable"));
  const byRep = new Map<number, typeof payable>();
  payable.forEach((deal) => byRep.set(deal.repId, [...(byRep.get(deal.repId) || []), deal]));
  const results: { repId: number; status: string; grossKobo?: number; netKobo?: number; reason?: string }[] = [];
  for (const [repId, repDeals] of byRep) {
    const [rep] = await db().select().from(reps).where(eq(reps.id, repId)).limit(1);
    const [user] = rep ? await db().select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];
    if (!rep || !user || rep.status !== "active" || user.kycState !== "verified" || !user.bankNameMatch) {
      results.push({ repId, status: "held", reason: "KYC, rep status, or bank name-match pre-flight failed" });
      continue;
    }
    const gross = repDeals.reduce((total, deal) => total + deal.repCommissionKobo, 0);
    const outstanding = await repOutstandingKobo(repId);
    const adjustedGross = Math.min(gross, Math.max(0, outstanding));
    if (adjustedGross < 50_000) {
      results.push({ repId, status: "rolled", grossKobo: adjustedGross, reason: "Below ₦500 minimum after clawback netting" });
      continue;
    }
    const tax = withholdingKobo(adjustedGross);
    const net = adjustedGross - tax;
    const batchId = `KF-${new Date().toISOString().slice(0, 10)}-${randomReference("batch").slice(-8)}`;
    const providerRef = randomReference("sandbox_paystack");
    const [payoutId] = await db().insert(payouts).values({ repId, amountGrossKobo: adjustedGross, amountNetKobo: net, withholdingKobo: tax, provider: "paystack_sandbox", providerRef, state: "paid", batchId, attempts: 1, paidAt: new Date() }).$returningId();
    const group = randomReference("payout");
    await db().insert(ledgerEntries).values([
      { payoutId: payoutId.id, account: "rep_payable", direction: "debit", amountKobo: adjustedGross, entryGroup: group },
      { payoutId: payoutId.id, account: "external_bank", direction: "credit", amountKobo: net, entryGroup: group },
      { payoutId: payoutId.id, account: "withholding_tax", direction: "credit", amountKobo: tax, entryGroup: group },
    ]);
    for (const deal of repDeals) await stateChange(db(), deal.id, "payable", "paid", `staff:${actorUserId}`, `Sandbox transfer ${providerRef}`);
    await db().insert(auditLogs).values({ actorUserId, action: "payout.batch_completed", entityType: "payout", entityId: String(payoutId.id), metadataJson: { provider: "paystack_sandbox", adjustedGross, net, tax } });
    results.push({ repId, status: "paid", grossKobo: adjustedGross, netKobo: net });
  }
  return { eligibleDeals: payable.length, results };
}
