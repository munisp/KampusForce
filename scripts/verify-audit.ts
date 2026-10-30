import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  assistedSessions,
  attributionRecords,
  authSessions,
  campusLeadOverrides,
  consentLogs,
  dealStateHistory,
  deals,
  disputes,
  escrowWallets,
  ledgerEntries,
  otpChallenges,
  products,
  reps,
  users,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { appRouter } from "../api/router";
import { attributionToken, ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent } from "../api/services/events";
import { openDealDispute, resolveDealDispute, reverseDeal } from "../api/services/ledger";
import { hashPhone } from "../api/services/security";

const db = getDb();
const caller = appRouter.createCaller({ req: new Request("http://audit.local/api/trpc", { headers: { origin: "http://audit.local" } }), resHeaders: new Headers() });
const uniquePhone = () => `+2348${String(randomInt(1_000_000_000)).padStart(9, "0")}`;
const rejected = async (operation: Promise<unknown>) => {
  const [result] = await Promise.allSettled([operation]);
  assert.equal(result.status, "rejected");
};

async function makeDeal(input: { repId: number; productId: number; vendorId: number; state: "pending" | "confirmed" | "payable" | "paid" }) {
  const phone = uniquePhone();
  const { attribution } = await ensureAttribution({ repId: input.repId, productId: input.productId, customerPhone: phone, source: "link" });
  const [deal] = await db.insert(deals).values({
    attributionId: attribution.id,
    productId: input.productId,
    vendorId: input.vendorId,
    repId: input.repId,
    customerPhoneHash: attribution.customerPhoneHash,
    triggerEvent: "funded",
    eventId: crypto.randomUUID(),
    state: input.state,
    vendorCommissionKobo: 100_000,
    repCommissionKobo: 80_000,
    platformFeeKobo: 20_000,
    confirmAt: new Date(Date.now() - 1000),
  }).returning();
  await db.insert(dealStateHistory).values({ dealId: deal.id, fromState: null, toState: input.state, actor: "audit:fixture", reason: "Synthetic state-transition fixture" });
  return deal;
}

async function main() {
  const [rep] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [teamRep] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  assert.ok(rep && teamRep && product);
  const [repUser] = await db.select().from(users).where(eq(users.id, rep.userId)).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, product.vendorId)).limit(1);
  assert.ok(repUser && vendor.userId);

  // Failed OTP attempts persist; five failures invalidate the challenge.
  const failedPhone = uniquePhone();
  const failedChallenge = await caller.auth.requestOtp({ phone: failedPhone });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await rejected(caller.auth.verifyOtp({ phone: failedPhone, code: failedChallenge.sandboxCode === "000000" ? "000001" : "000000" }));
  }
  const [failedOtp] = await db.select().from(otpChallenges).where(eq(otpChallenges.phoneE164, failedPhone)).orderBy(desc(otpChallenges.createdAt)).limit(1);
  assert.equal(failedOtp.attempts, 5);
  await rejected(caller.auth.verifyOtp({ phone: failedPhone, code: failedChallenge.sandboxCode }));
  assert.equal((await db.select().from(users).where(eq(users.phoneE164, failedPhone))).length, 0);

  // A valid challenge is single-use even when concurrent requests pass validation together.
  const replayPhone = uniquePhone();
  const replayChallenge = await caller.auth.requestOtp({ phone: replayPhone });
  const replayResults = await Promise.allSettled([
    caller.auth.verifyOtp({ phone: replayPhone, code: replayChallenge.sandboxCode, name: "Audit Concurrent Rep" }),
    caller.auth.verifyOtp({ phone: replayPhone, code: replayChallenge.sandboxCode, name: "Audit Concurrent Rep" }),
  ]);
  assert.equal(replayResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(replayResults.filter((result) => result.status === "rejected").length, 1);
  const [replayUser] = await db.select().from(users).where(eq(users.phoneE164, replayPhone)).limit(1);
  assert.equal((await db.select().from(reps).where(eq(reps.userId, replayUser.id))).length, 1);
  assert.equal((await db.select().from(authSessions).where(eq(authSessions.userId, replayUser.id))).length, 1);
  const [replayRep] = await db.select().from(reps).where(eq(reps.userId, replayUser.id)).limit(1);
  assert.match(replayRep.code, /^KF-UNILAG-[A-F0-9]{12}$/);

  // Competing first touches return one immutable winner and one consent record.
  const attributionPhone = uniquePhone();
  const firstTouches = await Promise.all([
    ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: attributionPhone, source: "link" }),
    ensureAttribution({ repId: teamRep.id, productId: product.id, customerPhone: attributionPhone, source: "qr" }),
    ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: attributionPhone, source: "assisted" }),
  ]);
  assert.equal(new Set(firstTouches.map((result) => result.attribution.id)).size, 1);
  assert.equal(firstTouches.filter((result) => result.created).length, 1);
  const attributionHash = firstTouches[0].phoneHash;
  assert.equal((await db.select().from(attributionRecords).where(eq(attributionRecords.customerPhoneHash, attributionHash))).length, 1);
  assert.equal((await db.select().from(consentLogs).where(eq(consentLogs.phoneHash, attributionHash))).length, 1);

  // Share URLs and public redirect inputs contain no customer identifier.
  const repSession = await caller.auth.demoLogin({ role: "rep", repCode: rep.code });
  const share = await caller.rep.share({ token: repSession.token, productId: product.id, customerPhone: uniquePhone(), source: "qr" });
  assert.ok(!share.url.includes("phone="));
  assert.ok(!/\+234|\d{10,}/.test(new URL(share.url).search));

  // A normal signed vendor handoff creates first-touch attribution on return;
  // it is not misclassified as a promotion token. Forged handoffs quarantine.
  const handoffPhone = uniquePhone();
  const handoffResult = await ingestVendorEvent(vendor.webhookKey, {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: handoffPhone, customer_ref: `audit-${crypto.randomUUID()}` },
    product_ref: product.vendorRef,
    amount_kobo: 500_000,
    meta: { kf_token: attributionToken(rep.id, product.id, vendor.id) },
  });
  assert.equal(handoffResult.status, "accepted");
  const [handoffAttribution] = await db.select().from(attributionRecords).where(eq(attributionRecords.customerPhoneHash, hashPhone(handoffPhone))).limit(1);
  assert.equal(handoffAttribution.repId, rep.id);
  const forgedPhone = uniquePhone();
  const forgedResult = await ingestVendorEvent(vendor.webhookKey, {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: forgedPhone, customer_ref: `audit-${crypto.randomUUID()}` },
    product_ref: product.vendorRef,
    amount_kobo: 500_000,
    meta: { kf_token: "forged.handoff" },
  });
  assert.equal(forgedResult.status, "quarantined");
  assert.equal((await db.select().from(attributionRecords).where(eq(attributionRecords.customerPhoneHash, hashPhone(forgedPhone)))).length, 0);

  // Atomic increments cannot overwrite concurrent sandbox top-ups.
  const [walletBefore] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  const vendorSession = await caller.auth.demoLogin({ role: "vendor" });
  await Promise.all(Array.from({ length: 20 }, () => caller.vendor.topupEscrow({ token: vendorSession.token, amountKobo: 10_000 })));
  const [walletAfter] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  assert.equal(walletAfter.balanceKobo, walletBefore.balanceKobo + 200_000);

  // Assisted onboarding is idempotent on the current step, forward-only, and final.
  const assisted = await caller.rep.assistedStart({ token: repSession.token, productId: product.id, customerPhone: uniquePhone() });
  await rejected(caller.rep.assistedAdvance({ token: repSession.token, sessionId: assisted.sessionId, step: 3 }));
  await caller.rep.assistedAdvance({ token: repSession.token, sessionId: assisted.sessionId, step: 2 });
  await caller.rep.assistedAdvance({ token: repSession.token, sessionId: assisted.sessionId, step: 2 });
  await rejected(caller.rep.assistedAdvance({ token: repSession.token, sessionId: assisted.sessionId, step: 1 }));
  for (const step of [3, 4, 5, 6]) await caller.rep.assistedAdvance({ token: repSession.token, sessionId: assisted.sessionId, step });
  await rejected(caller.rep.assistedAdvance({ token: repSession.token, sessionId: assisted.sessionId, step: 5 }));
  const [completedAssisted] = await db.select().from(assistedSessions).where(eq(assistedSessions.id, assisted.sessionId)).limit(1);
  assert.equal(completedAssisted.status, "completed");

  // Pending disputes restore or void correctly and cannot be decided twice.
  const pendingDeal = await makeDeal({ repId: rep.id, productId: product.id, vendorId: vendor.id, state: "pending" });
  const pendingDispute = await openDealDispute({ dealId: pendingDeal.id, repId: rep.id, actorUserId: repUser.id, reasonCode: "audit_pending" });
  await resolveDealDispute({ disputeId: pendingDispute.disputeId, actorUserId: repUser.id, upholdRep: true, decision: "Restore the pending activation for ordinary confirmation." });
  assert.equal((await db.select().from(deals).where(eq(deals.id, pendingDeal.id)).limit(1))[0].state, "pending");
  await rejected(resolveDealDispute({ disputeId: pendingDispute.disputeId, actorUserId: repUser.id, upholdRep: false, decision: "A second decision must not be accepted." }));
  const rejectedPendingDeal = await makeDeal({ repId: rep.id, productId: product.id, vendorId: vendor.id, state: "pending" });
  const rejectedPendingDispute = await openDealDispute({ dealId: rejectedPendingDeal.id, repId: rep.id, actorUserId: repUser.id, reasonCode: "audit_pending_reject" });
  await resolveDealDispute({ disputeId: rejectedPendingDispute.disputeId, actorUserId: repUser.id, upholdRep: false, decision: "Void this unconfirmed activation without creating a reversal." });
  assert.equal((await db.select().from(deals).where(eq(deals.id, rejectedPendingDeal.id)).limit(1))[0].state, "void");
  assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, rejectedPendingDeal.id))).length, 0);

  // Confirmed entitlements return to ordinary payout eligibility, while a
  // rejected payable dispute reverses the preserved financial entitlement.
  const confirmedDeal = await makeDeal({ repId: rep.id, productId: product.id, vendorId: vendor.id, state: "confirmed" });
  const confirmedDispute = await openDealDispute({ dealId: confirmedDeal.id, repId: rep.id, actorUserId: repUser.id, reasonCode: "audit_confirmed_restore" });
  const confirmedRestored = await resolveDealDispute({ disputeId: confirmedDispute.disputeId, actorUserId: repUser.id, upholdRep: true, decision: "Return the confirmed entitlement to the normal payable state." });
  assert.equal(confirmedRestored.dealState, "payable");
  const payableDeal = await makeDeal({ repId: rep.id, productId: product.id, vendorId: vendor.id, state: "payable" });
  const payableDispute = await openDealDispute({ dealId: payableDeal.id, repId: rep.id, actorUserId: repUser.id, reasonCode: "audit_payable_reverse" });
  const payableReversed = await resolveDealDispute({ disputeId: payableDispute.disputeId, actorUserId: repUser.id, upholdRep: false, decision: "Reverse the unpaid confirmed commission once." });
  assert.equal(payableReversed.dealState, "void");
  assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, payableDeal.id))).length, 3);

  // A vendor refund during a dispute uses the same preserved pre-dispute state
  // and closes the dispute instead of ignoring the underlying entitlement.
  const refundDeal = await makeDeal({ repId: rep.id, productId: product.id, vendorId: vendor.id, state: "payable" });
  const refundDispute = await openDealDispute({ dealId: refundDeal.id, repId: rep.id, actorUserId: repUser.id, reasonCode: "audit_vendor_refund" });
  const refundResult = await reverseDeal(refundDeal.id, `vendor:${vendor.id}:refund`);
  assert.equal(refundResult.state, "void");
  const [closedRefundDispute] = await db.select().from(disputes).where(eq(disputes.id, refundDispute.disputeId)).limit(1);
  assert.equal(closedRefundDispute.state, "rejected");
  assert.equal(closedRefundDispute.previousDealState, "payable");
  assert.equal((await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, refundDeal.id))).length, 3);

  // Paid disputes return to paid when upheld, never to a second payable entitlement.
  const paidRestoredDeal = await makeDeal({ repId: rep.id, productId: product.id, vendorId: vendor.id, state: "paid" });
  const paidRestoredDispute = await openDealDispute({ dealId: paidRestoredDeal.id, repId: rep.id, actorUserId: repUser.id, reasonCode: "audit_paid_restore" });
  const restored = await resolveDealDispute({ disputeId: paidRestoredDispute.disputeId, actorUserId: repUser.id, upholdRep: true, decision: "The original paid settlement remains valid and must not be duplicated." });
  assert.equal(restored.dealState, "paid");
  assert.equal((await db.select().from(deals).where(eq(deals.id, paidRestoredDeal.id)).limit(1))[0].state, "paid");

  // Rejecting a paid dispute performs one complete clawback, including the paid lead override.
  const paidReversedDeal = await makeDeal({ repId: teamRep.id, productId: product.id, vendorId: vendor.id, state: "paid" });
  const [paidOverride] = await db.insert(campusLeadOverrides).values({
    dealId: paidReversedDeal.id,
    leadRepId: rep.id,
    sourceRepId: teamRep.id,
    campusId: rep.campusId,
    teamCommissionKobo: 80_000,
    overrideKobo: 4_000,
    platformMarginKobo: 20_000,
    platformMarginAfterKobo: 16_000,
    state: "paid",
  }).returning();
  const [reversalWalletBefore] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  const paidReversedDispute = await openDealDispute({ dealId: paidReversedDeal.id, repId: teamRep.id, actorUserId: repUser.id, reasonCode: "audit_paid_reverse" });
  await resolveDealDispute({ disputeId: paidReversedDispute.disputeId, actorUserId: repUser.id, upholdRep: false, decision: "Reverse the paid entitlement and platform-funded override once." });
  assert.equal((await db.select().from(deals).where(eq(deals.id, paidReversedDeal.id)).limit(1))[0].state, "clawed_back");
  assert.equal((await db.select().from(campusLeadOverrides).where(eq(campusLeadOverrides.id, paidOverride.id)).limit(1))[0].state, "reversed");
  const [reversalWalletAfter] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  assert.equal(reversalWalletAfter.balanceKobo, reversalWalletBefore.balanceKobo + 100_000);
  const reversalEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, paidReversedDeal.id));
  assert.equal(reversalEntries.length, 5);
  assert.equal(new Set(reversalEntries.map((entry) => entry.entryGroup)).size, 1);
  const [decidedDispute] = await db.select().from(disputes).where(eq(disputes.id, paidReversedDispute.disputeId)).limit(1);
  assert.equal(decidedDispute.previousDealState, "paid");
  assert.equal(decidedDispute.decidedByUserId, repUser.id);
  assert.equal((await db.select().from(dealStateHistory).where(and(eq(dealStateHistory.dealId, paidReversedDeal.id), eq(dealStateHistory.toState, "clawed_back")))).length, 1);

  console.log(JSON.stringify({
    status: "passed",
    otp: { failedAttempts: 5, concurrentWinners: 1, sessions: 1 },
    attribution: { concurrentFirstTouches: firstTouches.length, records: 1, rawPhoneInShareUrl: false, signedVendorHandoffAccepted: handoffResult.status === "accepted", forgedHandoffQuarantined: forgedResult.status === "quarantined" },
    escrow: { concurrentTopups: 20, creditedKobo: 200_000 },
    assisted: { forwardOnly: true, completedSessionReopened: false },
    disputes: { restoredPending: true, rejectedPendingLedgerEntries: 0, restoredConfirmedState: confirmedRestored.dealState, reversedPayableLedgerEntries: 3, vendorRefundDuringDispute: refundResult.state, restoredPaid: true, paidClawbackEntries: reversalEntries.length, paidOverrideReversed: true },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await db.$client.end();
});
