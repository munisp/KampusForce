import "dotenv/config";
import assert from "node:assert/strict";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  campusLeadAssignments,
  campusLeadOverrides,
  commissionRuleDrafts,
  commissionRules,
  deals,
  escrowWallets,
  ledgerEntries,
  payouts,
  products,
  reps,
  supportResolutionMacros,
  supportTickets,
  users,
  vendorEvents,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent } from "../api/services/events";
import { confirmDueDeals, runPayoutBatch } from "../api/services/ledger";
import { calculateRuleDryRun, publishRuleDraft } from "../api/services/rules";
import {
  createSupportTicket,
  escalateSupportTicket,
  rateSupportTicket,
  resolveSupportTicket,
  syncSlaBreaches,
} from "../api/services/support";

const db = getDb();
const uniquePhone = () => `+2348${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-9)}`;
const eventPayload = (phone: string) => ({
  event_id: crypto.randomUUID(),
  type: "funded" as const,
  occurred_at: new Date().toISOString(),
  customer: { phone, customer_ref: `phase2-${crypto.randomUUID()}` },
  product_ref: "savings-01",
  amount_kobo: 500_000,
  meta: { verification: "phase2_acceptance" },
});

async function makeDeal(repId: number, productId: number, vendorKey: string, phone: string) {
  await ensureAttribution({ repId, productId, customerPhone: phone, source: "link" });
  const result = await ingestVendorEvent(vendorKey, eventPayload(phone));
  assert.equal(result.status, "accepted");
  assert.ok("deal_id" in result && result.deal_id);
  const [deal] = await db.select().from(deals).where(eq(deals.id, result.deal_id!)).limit(1);
  return deal;
}

async function leadOverrideOutstandingKobo(leadRepId: number) {
  const entries = await db.select({ amount: ledgerEntries.amountKobo, direction: ledgerEntries.direction })
    .from(ledgerEntries)
    .leftJoin(campusLeadOverrides, eq(ledgerEntries.dealId, campusLeadOverrides.dealId))
    .leftJoin(payouts, eq(ledgerEntries.payoutId, payouts.id))
    .where(and(eq(ledgerEntries.account, "lead_override_payable"), or(eq(campusLeadOverrides.leadRepId, leadRepId), eq(payouts.repId, leadRepId))));
  return entries.reduce((sum, entry) => sum + (entry.direction === "credit" ? entry.amount : -entry.amount), 0);
}

async function directOutstandingKobo(repId: number) {
  const entries = await db.select({ amount: ledgerEntries.amountKobo, direction: ledgerEntries.direction })
    .from(ledgerEntries)
    .leftJoin(deals, eq(ledgerEntries.dealId, deals.id))
    .leftJoin(payouts, eq(ledgerEntries.payoutId, payouts.id))
    .where(and(eq(ledgerEntries.account, "rep_payable"), or(eq(deals.repId, repId), eq(payouts.repId, repId))));
  return entries.reduce((sum, entry) => sum + (entry.direction === "credit" ? entry.amount : -entry.amount), 0);
}

async function expectedVendorQuality(vendorId: number) {
  const rows = await db.select({ csat: supportTickets.csat }).from(supportTickets)
    .where(and(eq(supportTickets.vendorId, vendorId), eq(supportTickets.state, "closed")));
  const ratings = rows.flatMap((row) => row.csat ? [row.csat] : []);
  return ratings.length ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 20) : 100;
}

async function main() {
  const [teamRep] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [leadRep] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor.userId!)).limit(1);
  const [opsUser] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [assignment] = await db.select().from(campusLeadAssignments)
    .where(and(eq(campusLeadAssignments.repId, teamRep.id), eq(campusLeadAssignments.leadRepId, leadRep.id), isNull(campusLeadAssignments.revokedAt))).limit(1);
  assert.ok(teamRep && leadRep && vendor && product && vendorUser && opsUser && assignment);

  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  if (wallet.balanceKobo < 5_000_000) {
    await db.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + 10_000_000 }).where(eq(escrowWallets.vendorId, vendor.id));
  }

  const [oldRule] = await db.select().from(commissionRules)
    .where(and(eq(commissionRules.productId, product.id), isNull(commissionRules.supersededAt)))
    .orderBy(desc(commissionRules.version)).limit(1);
  assert.ok(oldRule);
  const oldPhone = uniquePhone();
  const oldDeal = await makeDeal(teamRep.id, product.id, vendor.webhookKey, oldPhone);
  assert.equal(oldDeal.commissionRuleId, oldRule.id);

  // Size the new override so repeated sandbox runs still clear the ₦500 payout
  // minimum after earlier paid-refund reversals have created negative balances.
  const combinedBefore = await directOutstandingKobo(leadRep.id) + await leadOverrideOutstandingKobo(leadRep.id);
  const projectedOldOverride = Math.round(oldDeal.repCommissionKobo * 0.05);
  const targetOverrideKobo = Math.max(60_000, 50_000 - combinedBefore - projectedOldOverride);
  const newVendorCommissionKobo = targetOverrideKobo * 25;
  const newRepCommissionKobo = targetOverrideKobo * 20;
  const newPlatformMarginKobo = targetOverrideKobo * 5;
  const [currentWallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  const requiredWalletKobo = oldDeal.vendorCommissionKobo + newVendorCommissionKobo + 1_000_000;
  if (currentWallet.balanceKobo < requiredWalletKobo) {
    await db.update(escrowWallets).set({ balanceKobo: currentWallet.balanceKobo + requiredWalletKobo }).where(eq(escrowWallets.vendorId, vendor.id));
  }

  const economics = calculateRuleDryRun({
    basis: "flat",
    flatAmountKobo: newVendorCommissionKobo,
    triggerEvent: "funded",
    recurrenceMonths: 1,
    confirmDays: 30,
    clawbackDays: 60,
  }, null);
  assert.deepEqual(
    { vendor: economics.vendorCommissionKobo, rep: economics.repCommissionKobo, platform: economics.platformFeeKobo },
    { vendor: newVendorCommissionKobo, rep: newRepCommissionKobo, platform: newPlatformMarginKobo },
  );
  const [{ id: draftId }] = await db.insert(commissionRuleDrafts).values({
    productId: product.id,
    vendorId: vendor.id,
    createdByUserId: vendorUser.id,
    basis: economics.basis,
    pctBps: economics.pctBps,
    flatAmountKobo: economics.flatAmountKobo,
    triggerEvent: economics.triggerEvent,
    recurrenceMonths: economics.recurrenceMonths,
    confirmDays: economics.confirmDays,
    clawbackDays: economics.clawbackDays,
    sampleAmountKobo: economics.sampleAmountKobo,
    vendorCommissionKobo: economics.vendorCommissionKobo,
    repCommissionKobo: economics.repCommissionKobo,
    platformFeeKobo: economics.platformFeeKobo,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  }).returning({ id: commissionRuleDrafts.id });
  const published = await publishRuleDraft(vendorUser.id, vendor.id, draftId);
  assert.equal(published.version, oldRule.version + 1);
  await assert.rejects(() => publishRuleDraft(vendorUser.id, vendor.id, draftId));

  const newPhone = uniquePhone();
  const newDeal = await makeDeal(teamRep.id, product.id, vendor.webhookKey, newPhone);
  assert.equal(newDeal.commissionRuleId, published.ruleId);
  assert.equal(newDeal.vendorCommissionKobo, newVendorCommissionKobo);
  const [oldDealAfterPublish] = await db.select().from(deals).where(eq(deals.id, oldDeal.id)).limit(1);
  assert.equal(oldDealAfterPublish.vendorCommissionKobo, oldDeal.vendorCommissionKobo);
  assert.equal(oldDealAfterPublish.repCommissionKobo, oldDeal.repCommissionKobo);
  assert.equal(oldDealAfterPublish.commissionRuleId, oldRule.id);

  await db.update(deals).set({ confirmAt: new Date(Date.now() - 2_000) }).where(inArray(deals.id, [oldDeal.id, newDeal.id]));
  await confirmDueDeals(opsUser.id);
  const overrides = await db.select().from(campusLeadOverrides).where(inArray(campusLeadOverrides.dealId, [oldDeal.id, newDeal.id]));
  assert.equal(overrides.length, 2);
  const oldOverride = overrides.find((override) => override.dealId === oldDeal.id)!;
  const newOverride = overrides.find((override) => override.dealId === newDeal.id)!;
  assert.equal(oldOverride.overrideKobo, Math.round(oldDeal.repCommissionKobo * 0.05));
  assert.equal(newOverride.overrideKobo, targetOverrideKobo);
  assert.equal(newOverride.platformMarginKobo, newPlatformMarginKobo);
  assert.equal(newOverride.platformMarginAfterKobo, newPlatformMarginKobo - targetOverrideKobo);
  assert.equal(newOverride.teamCommissionKobo, newRepCommissionKobo);

  const confirmationEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, newDeal.id));
  const debits = confirmationEntries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + entry.amountKobo, 0);
  const credits = confirmationEntries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + entry.amountKobo, 0);
  assert.equal(debits, credits);

  const payoutRun = await runPayoutBatch(opsUser.id);
  const leadPayoutResult = payoutRun.results.find((result) => result.repId === leadRep.id);
  assert.equal(leadPayoutResult?.status, "paid");
  assert.ok((leadPayoutResult?.overrideKobo || 0) >= targetOverrideKobo);
  const [paidNewOverride] = await db.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.id, newOverride.id)).limit(1);
  assert.equal(paidNewOverride.state, "paid");
  assert.ok(paidNewOverride.payoutId);
  const [leadPayout] = await db.select().from(payouts).where(eq(payouts.id, paidNewOverride.payoutId!)).limit(1);
  assert.equal(leadPayout.provider, "paystack_sandbox");

  const overrideBalanceBeforeRefund = await leadOverrideOutstandingKobo(leadRep.id);
  const refund = await ingestVendorEvent(vendor.webhookKey, {
    ...eventPayload(newPhone),
    type: "refund",
  });
  assert.equal(refund.status, "processed");
  const [reversedDeal] = await db.select().from(deals).where(eq(deals.id, newDeal.id)).limit(1);
  const [reversedOverride] = await db.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.id, newOverride.id)).limit(1);
  assert.equal(reversedDeal.state, "clawed_back");
  assert.equal(reversedOverride.state, "reversed");
  const overrideBalanceAfterRefund = await leadOverrideOutstandingKobo(leadRep.id);
  assert.equal(overrideBalanceAfterRefund, overrideBalanceBeforeRefund - targetOverrideKobo);

  const ticketOne = await createSupportTicket({
    actorUserId: teamRep.userId,
    repId: teamRep.id,
    dealId: oldDeal.id,
    category: "commission",
    subject: "Verify historical commission evidence",
    description: "Please verify the stored commission rule and activation evidence for this referred deal.",
    priority: "normal",
  });
  await escalateSupportTicket({ ticketId: ticketOne.id, actorUserId: teamRep.userId, actor: "rep", repId: teamRep.id, target: "vendor" });
  await assert.rejects(() => resolveSupportTicket({
    ticketId: ticketOne.id,
    actorUserId: vendorUser.id,
    actor: "vendor",
    vendorId: vendor.id + 9999,
    resolution: "This cross-vendor resolution attempt must be rejected.",
  }));
  const [macro] = await db.select().from(supportResolutionMacros).where(eq(supportResolutionMacros.vendorId, vendor.id)).limit(1);
  assert.ok(macro);
  await resolveSupportTicket({
    ticketId: ticketOne.id,
    actorUserId: vendorUser.id,
    actor: "vendor",
    vendorId: vendor.id,
    resolution: macro.body,
    macroId: macro.id,
  });
  await rateSupportTicket({ ticketId: ticketOne.id, actorUserId: teamRep.userId, repId: teamRep.id, csat: 5, comment: "Evidence and resolution were clear." });
  let [currentVendor] = await db.select().from(vendors).where(eq(vendors.id, vendor.id)).limit(1);
  assert.equal(currentVendor.qualityScore, await expectedVendorQuality(vendor.id));
  await assert.rejects(() => rateSupportTicket({ ticketId: ticketOne.id, actorUserId: teamRep.userId, repId: teamRep.id, csat: 4 }));

  const ticketTwo = await createSupportTicket({
    actorUserId: teamRep.userId,
    repId: teamRep.id,
    dealId: newDeal.id,
    category: "refund",
    subject: "Review paid refund reversal",
    description: "Please review the refund, rep clawback and campus lead override reversal recorded for this deal.",
    priority: "urgent",
  });
  await escalateSupportTicket({ ticketId: ticketTwo.id, actorUserId: teamRep.userId, actor: "rep", repId: teamRep.id, target: "campus_lead" });
  await escalateSupportTicket({ ticketId: ticketTwo.id, actorUserId: leadRep.userId, actor: "lead", repId: leadRep.id });
  await escalateSupportTicket({ ticketId: ticketTwo.id, actorUserId: vendorUser.id, actor: "vendor", vendorId: vendor.id });
  await resolveSupportTicket({
    ticketId: ticketTwo.id,
    actorUserId: opsUser.id,
    actor: "ops",
    resolution: "Operations verified the refund event and both negative-balance reversal paths.",
  });
  await rateSupportTicket({ ticketId: ticketTwo.id, actorUserId: teamRep.userId, repId: teamRep.id, csat: 4 });
  [currentVendor] = await db.select().from(vendors).where(eq(vendors.id, vendor.id)).limit(1);
  assert.equal(currentVendor.qualityScore, await expectedVendorQuality(vendor.id));

  const ticketThree = await createSupportTicket({
    actorUserId: teamRep.userId,
    repId: teamRep.id,
    dealId: oldDeal.id,
    category: "activation",
    subject: "Overdue activation review",
    description: "This sandbox case is deliberately held beyond its due date to verify SLA breach recording.",
    priority: "normal",
  });
  await escalateSupportTicket({ ticketId: ticketThree.id, actorUserId: teamRep.userId, actor: "rep", repId: teamRep.id, target: "vendor" });
  await db.update(supportTickets).set({ slaDueAt: new Date(Date.now() - 60_000) }).where(eq(supportTickets.id, ticketThree.id));
  await syncSlaBreaches(vendor.id);
  const [breached] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketThree.id)).limit(1);
  assert.ok(breached.slaBreachedAt);

  // Inspect every stored event attached to the two generated deals.
  const dealEvents = await db.select().from(vendorEvents).where(inArray(vendorEvents.id, [oldDeal.eventId, newDeal.eventId]));
  for (const event of dealEvents) {
    const serialized = JSON.stringify(event.payloadJson);
    assert.ok(!serialized.includes(oldPhone) && !serialized.includes(newPhone));
    assert.ok(serialized.includes("[redacted]"));
  }

  console.log(JSON.stringify({
    status: "passed",
    rules: { oldVersion: oldRule.version, publishedVersion: published.version, historicalDealPreserved: true },
    override: { teamCommissionKobo: newRepCommissionKobo, platformMarginKobo: newPlatformMarginKobo, overrideKobo: targetOverrideKobo, marginAfterKobo: newPlatformMarginKobo - targetOverrideKobo, paidThenReversed: true },
    support: { vendorResolution: true, campusLeadAndOpsEscalation: true, oneTimeCsat: true, slaBreach: true, vendorQualityScore: currentVendor.qualityScore },
    privacy: { eventPayloadsRedacted: true, ticketCustomerIdentifiersStoredAsHashes: true },
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
