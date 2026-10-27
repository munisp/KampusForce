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

const db = () => getDb();

async function stateChange(tx: any, dealId: number, fromState: string | null, toState: string, actor: string, reason?: string) {
  await tx.update(deals).set({ state: toState as any, updatedAt: new Date() }).where(eq(deals.id, dealId));
  await tx.insert(dealStateHistory).values({ dealId, fromState, toState, actor, reason });
}

async function accrueCampusLeadOverride(tx: any, deal: typeof deals.$inferSelect, group: string) {
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
  const [deal] = await db().select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal || ["void", "clawed_back"].includes(deal.state)) return { reversed: false };
  if (["pending", "confirmed", "payable", "paid"].includes(deal.state) === false) return { reversed: false };
  await db().transaction(async (tx) => {
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

async function leadOverrideOutstandingKobo(leadRepId: number): Promise<number> {
  const entries = await db()
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
  const byRep = new Map<number, { deals: typeof payable; overrides: typeof accruedOverrides }>();
  const bucket = (repId: number) => {
    if (!byRep.has(repId)) byRep.set(repId, { deals: [], overrides: [] });
    return byRep.get(repId)!;
  };
  payable.forEach((deal) => bucket(deal.repId).deals.push(deal));
  accruedOverrides.forEach((override) => bucket(override.leadRepId).overrides.push(override));
  const results: { repId: number; status: string; grossKobo?: number; netKobo?: number; overrideKobo?: number; reason?: string }[] = [];
  for (const [repId, entitlements] of byRep) {
    const [rep] = await db().select().from(reps).where(eq(reps.id, repId)).limit(1);
    const [user] = rep ? await db().select().from(users).where(eq(users.id, rep.userId)).limit(1) : [];
    if (!rep || !user || rep.status !== "active" || user.kycState !== "verified" || !user.bankNameMatch) {
      results.push({ repId, status: "held", reason: "KYC, rep status, or bank name-match pre-flight failed" });
      continue;
    }
    const directGross = entitlements.deals.reduce((total, deal) => total + deal.repCommissionKobo, 0);
    const overrideGross = entitlements.overrides.reduce((total, override) => total + override.overrideKobo, 0);
    const gross = directGross + overrideGross;
    const directOutstanding = await repOutstandingKobo(repId);
    const overrideOutstanding = await leadOverrideOutstandingKobo(repId);
    const adjustedGross = Math.min(gross, Math.max(0, directOutstanding + overrideOutstanding));
    if (adjustedGross < 50_000) {
      results.push({ repId, status: "rolled", grossKobo: adjustedGross, overrideKobo: overrideGross, reason: "Below ₦500 minimum after clawback netting" });
      continue;
    }
    const tax = withholdingKobo(adjustedGross);
    const net = adjustedGross - tax;
    const batchId = `KF-${new Date().toISOString().slice(0, 10)}-${randomReference("batch").slice(-8)}`;
    const providerRef = randomReference("sandbox_paystack");
    const [payoutId] = await db().insert(payouts).values({ repId, amountGrossKobo: adjustedGross, amountNetKobo: net, withholdingKobo: tax, provider: "paystack_sandbox", providerRef, state: "paid", batchId, attempts: 1, paidAt: new Date() }).returning({ id: payouts.id });
    const group = randomReference("payout");
    const directDebit = Math.min(Math.max(0, directOutstanding), adjustedGross);
    const overrideDebit = adjustedGross - directDebit;
    const entries: (typeof ledgerEntries.$inferInsert)[] = [
      { payoutId: payoutId.id, account: "external_bank", direction: "credit", amountKobo: net, entryGroup: group },
      { payoutId: payoutId.id, account: "withholding_tax", direction: "credit", amountKobo: tax, entryGroup: group },
    ];
    if (directDebit) entries.push({ payoutId: payoutId.id, account: "rep_payable", direction: "debit", amountKobo: directDebit, entryGroup: group });
    if (overrideDebit) entries.push({ payoutId: payoutId.id, account: "lead_override_payable", direction: "debit", amountKobo: overrideDebit, entryGroup: group });
    await db().insert(ledgerEntries).values(entries);
    for (const deal of entitlements.deals) await stateChange(db(), deal.id, "payable", "paid", `staff:${actorUserId}`, `Sandbox transfer ${providerRef}`);
    for (const override of entitlements.overrides) await db().update(campusLeadOverrides).set({ state: "paid", payoutId: payoutId.id }).where(eq(campusLeadOverrides.id, override.id));
    await db().insert(auditLogs).values({ actorUserId, action: "payout.batch_completed", entityType: "payout", entityId: String(payoutId.id), metadataJson: { provider: "paystack_sandbox", adjustedGross, net, tax, directGross, overrideGross, directDebit, overrideDebit } });
    results.push({ repId, status: "paid", grossKobo: adjustedGross, netKobo: net, overrideKobo: overrideGross });
  }
  return { eligibleDeals: payable.length, eligibleOverrides: accruedOverrides.length, results };
}
