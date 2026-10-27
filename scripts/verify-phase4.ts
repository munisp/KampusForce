import "dotenv/config";
import assert from "node:assert/strict";
import { desc, eq } from "drizzle-orm";
import {
  deals,
  escrowWallets,
  ledgerEntries,
  payoutAttempts,
  payouts,
  products,
  reconciliationRuns,
  reps,
  users,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent } from "../api/services/events";
import {
  confirmDueDeals,
  dispatchDuePayouts,
  reconcilePayoutBatch,
  recordSandboxPayoutOutcome,
  recoverFailedPayout,
  reverseDeal,
  runPayoutBatch,
} from "../api/services/ledger";

const db = getDb();
const uniquePhone = () => `+2348${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-9)}`;

async function createActiveRep(label: string) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  const [campus] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [{ id: userId }] = await db.insert(users).values({
    phoneE164: uniquePhone(),
    name: label,
    role: "rep",
    kycState: "verified",
    ninToken: `sandbox_identity_${crypto.randomUUID()}`,
    bankName: "Sandbox Bank",
    bankCode: "999",
    bankAccountLast4: "0000",
    bankAccountName: label,
    bankNameMatch: true,
  }).returning({ id: users.id });
  const [{ id: repId }] = await db.insert(reps).values({
    userId,
    campusId: campus.campusId,
    code: `KF-TEST-${suffix}`,
    status: "active",
  }).returning({ id: reps.id });
  return { repId, userId };
}

async function makePayableDeal(repId: number) {
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const phone = uniquePhone();
  await ensureAttribution({ repId, productId: product.id, customerPhone: phone, source: "link" });
  const result = await ingestVendorEvent("campussave_sandbox", {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone, customer_ref: `phase4-${crypto.randomUUID()}` },
    product_ref: "savings-01",
    amount_kobo: 500_000,
    meta: { verification: "phase4_acceptance" },
  });
  assert.equal(result.status, "accepted");
  assert.ok("deal_id" in result && result.deal_id);
  await db.update(deals).set({ confirmAt: new Date(Date.now() - 1000) }).where(eq(deals.id, result.deal_id!));
  await confirmDueDeals();
  const [deal] = await db.select().from(deals).where(eq(deals.id, result.deal_id!)).limit(1);
  assert.equal(deal.state, "payable");
  return deal;
}

async function latestAttempt(payoutId: number) {
  const [attempt] = await db.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payoutId))
    .orderBy(desc(payoutAttempts.attemptNo), desc(payoutAttempts.id)).limit(1);
  return attempt;
}

async function main() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  assert.ok(ops && vendor);
  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  if (wallet.balanceKobo < 20_000_000) {
    await db.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + 50_000_000 }).where(eq(escrowWallets.vendorId, vendor.id));
  }

  const primary = await createActiveRep("Phase Four Retry Rep");
  const deal = await makePayableDeal(primary.repId);
  const assembled = await runPayoutBatch(ops.id);
  const queued = assembled.results.find((result) => result.repId === primary.repId);
  assert.equal(queued?.status, "queued");
  const payoutId = queued!.payoutId!;
  assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, payoutId))).length, 0);
  const duplicateAssembly = await runPayoutBatch(ops.id);
  assert.ok(!duplicateAssembly.results.some((result) => result.repId === primary.repId));

  await Promise.all([dispatchDuePayouts(ops.id), dispatchDuePayouts(ops.id), dispatchDuePayouts(ops.id)]);
  assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payoutId))).length, 1);

  for (let attemptNo = 1; attemptNo <= 3; attemptNo += 1) {
    const attempt = await latestAttempt(payoutId);
    assert.equal(attempt.attemptNo, attemptNo);
    assert.equal(attempt.provider, attemptNo === 3 ? "flutterwave_sandbox" : "paystack_sandbox");
    const failed = await recordSandboxPayoutOutcome({ payoutId, outcome: "failure", actorUserId: ops.id, failureCode: `sandbox_failure_${attemptNo}` });
    assert.equal(failed.status, attemptNo === 3 ? "failed" : "queued");
    assert.equal(failed.financeFlagged, attemptNo === 3);
    assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, payoutId))).length, 0);
    const [unpaidDeal] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
    assert.equal(unpaidDeal.state, "payable");
    if (attemptNo < 3) {
      await db.update(payouts).set({ nextRetryAt: new Date(Date.now() - 1000) }).where(eq(payouts.id, payoutId));
      await dispatchDuePayouts(ops.id);
    }
  }

  const recovered = await recoverFailedPayout(payoutId, ops.id);
  assert.equal(recovered.replacesFailedPayoutId, payoutId);
  const [oldFailure] = await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
  assert.equal(oldFailure.state, "failed");
  assert.equal((await db.select().from(payoutAttempts).where(eq(payoutAttempts.payoutId, payoutId))).length, 3);
  await dispatchDuePayouts(ops.id);
  const paid = await recordSandboxPayoutOutcome({ payoutId: recovered.payoutId, outcome: "success", actorUserId: ops.id });
  assert.equal(paid.status, "paid");
  const duplicateSuccess = await recordSandboxPayoutOutcome({ payoutId: recovered.payoutId, outcome: "success", actorUserId: ops.id });
  assert.equal(duplicateSuccess.idempotent, true);
  assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, recovered.payoutId))).length, 3);
  const [paidDeal] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
  assert.equal(paidDeal.state, "paid");
  const [recoveredPayout] = await db.select().from(payouts).where(eq(payouts.id, recovered.payoutId)).limit(1);

  const matched = await reconcilePayoutBatch({ batchId: recoveredPayout.batchId, bankNetKobo: recoveredPayout.amountNetKobo, actorUserId: ops.id });
  assert.equal(matched.state, "matched");
  assert.equal(matched.ledgerKobo, recoveredPayout.amountNetKobo);
  assert.equal(matched.providerKobo, recoveredPayout.amountNetKobo);
  const variance = await reconcilePayoutBatch({ batchId: recoveredPayout.batchId, bankNetKobo: recoveredPayout.amountNetKobo + 100001, actorUserId: ops.id });
  assert.equal(variance.state, "variance");
  assert.equal(variance.varianceKobo, 100001);
  await assert.rejects(() => db.update(reconciliationRuns).set({ bankKobo: 0 }).where(eq(reconciliationRuns.id, variance.id)));

  const heldRep = await createActiveRep("Phase Four Held Rep");
  const heldDeal = await makePayableDeal(heldRep.repId);
  const heldAssembly = await runPayoutBatch(ops.id);
  const heldPayoutId = heldAssembly.results.find((result) => result.repId === heldRep.repId)!.payoutId!;
  await dispatchDuePayouts(ops.id);
  const reversal = await reverseDeal(heldDeal.id, "phase4:refund_before_settlement");
  assert.equal(reversal.reversed, true);
  const held = await recordSandboxPayoutOutcome({ payoutId: heldPayoutId, outcome: "success", actorUserId: ops.id });
  assert.equal(held.status, "held");
  assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, heldPayoutId))).length, 0);
  const [heldPayout] = await db.select().from(payouts).where(eq(payouts.id, heldPayoutId)).limit(1);
  assert.equal(heldPayout.lastFailureCode, "settlement_preflight_changed");

  console.log(JSON.stringify({
    status: "passed",
    lifecycle: { assemblyPostsNoSettlement: true, duplicateAssemblyPrevented: true, concurrentDispatchAttempts: 1, idempotentSuccess: true },
    recovery: { failedAttempts: 3, fallbackProvider: "flutterwave_sandbox", financeFlagged: true, replacementPayoutId: recovered.payoutId, failedHistoryPreserved: true },
    reconciliation: { exactMatch: true, varianceKobo: variance.varianceKobo, appendOnly: true, evidence: "sandbox_only" },
    safety: { refundBeforeSettlementHeld: true, heldPayoutLedgerEntries: 0 },
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
