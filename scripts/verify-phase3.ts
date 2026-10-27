import "dotenv/config";
import assert from "node:assert/strict";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  auditLogs,
  campusLeadAssignments,
  campusRecruitments,
  commissionRuleDrafts,
  commissionRules,
  deals,
  escrowWallets,
  ledgerEntries,
  payouts,
  products,
  reps,
  users,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { ensureAttribution } from "../api/services/attribution";
import { ingestVendorEvent } from "../api/services/events";
import { confirmDueDeals, runPayoutBatch } from "../api/services/ledger";
import { runDurableJob } from "../api/services/jobs";
import { listNotifications } from "../api/services/notifications";
import {
  acceptRecruitment,
  activateRecruitment,
  createInvitationToken,
  hashInvitationToken,
  inspectRecruitment,
  revokeRecruitment,
} from "../api/services/recruiting";
import { calculateRuleDryRun, publishRuleDraft } from "../api/services/rules";
import { campusTelemetry } from "../api/services/telemetry";

const db = getDb();
const uniquePhone = () => `+2348${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-9)}`;

async function makeDeal(repId: number, phone: string) {
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  await ensureAttribution({ repId, productId: product.id, customerPhone: phone, source: "link" });
  const result = await ingestVendorEvent("campussave_sandbox", {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone, customer_ref: `phase3-${crypto.randomUUID()}` },
    product_ref: "savings-01",
    amount_kobo: 500_000,
    meta: { verification: "phase3_acceptance" },
  });
  assert.equal(result.status, "accepted");
  assert.ok("deal_id" in result && result.deal_id);
  const [deal] = await db.select().from(deals).where(eq(deals.id, result.deal_id!)).limit(1);
  return deal;
}

async function main() {
  const [lead] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor.userId!)).limit(1);
  assert.ok(lead && ops && vendor && product && vendorUser);
  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  if (wallet.balanceKobo < 5_000_000) await db.update(escrowWallets).set({ balanceKobo: wallet.balanceKobo + 20_000_000 }).where(eq(escrowWallets.vendorId, vendor.id));

  const invitedPhone = uniquePhone();
  const [{ id: recruitUserId }] = await db.insert(users).values({ phoneE164: invitedPhone, name: "Phase Three Recruit", role: "rep" }).returning({ id: users.id });
  const [{ id: otherUserId }] = await db.insert(users).values({ phoneE164: uniquePhone(), name: "Wrong Phone User", role: "rep" }).returning({ id: users.id });
  const token = createInvitationToken();
  const [{ id: recruitmentId }] = await db.insert(campusRecruitments).values({ leadRepId: lead.id, campusId: lead.campusId, name: "Phase Three Recruit", phoneE164: invitedPhone, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 86_400_000) }).returning({ id: campusRecruitments.id });
  const publicInspection = await inspectRecruitment(token);
  assert.equal(publicInspection.status, "invited");
  assert.ok(!JSON.stringify(publicInspection).includes(invitedPhone));
  await assert.rejects(() => acceptRecruitment(otherUserId, token, true));
  const accepted = await acceptRecruitment(recruitUserId, token, true);
  assert.equal(accepted.status, "accepted");
  await assert.rejects(() => acceptRecruitment(recruitUserId, token, true));
  const [storedInvitation] = await db.select().from(campusRecruitments).where(eq(campusRecruitments.id, recruitmentId)).limit(1);
  assert.notEqual(storedInvitation.tokenHash, token);
  assert.equal(storedInvitation.tokenHash.length, 64);
  const activated = await activateRecruitment(recruitmentId, ops.id);
  assert.equal(activated.mode, "sandbox_identity");
  const [activeRep] = await db.select().from(reps).where(eq(reps.id, activated.repId)).limit(1);
  const [activeUser] = await db.select().from(users).where(eq(users.id, recruitUserId)).limit(1);
  const [assignment] = await db.select().from(campusLeadAssignments).where(eq(campusLeadAssignments.repId, activeRep.id)).limit(1);
  assert.equal(activeRep.status, "active");
  assert.equal(activeUser.kycState, "verified");
  assert.ok(activeUser.ninToken?.startsWith("sandbox_identity_"));
  assert.equal(assignment.leadRepId, lead.id);
  await assert.rejects(() => activateRecruitment(recruitmentId, ops.id));

  const revokedToken = createInvitationToken();
  const [{ id: revokedId }] = await db.insert(campusRecruitments).values({ leadRepId: lead.id, campusId: lead.campusId, name: "Revoked Recruit", phoneE164: uniquePhone(), tokenHash: hashInvitationToken(revokedToken), expiresAt: new Date(Date.now() + 86_400_000) }).returning({ id: campusRecruitments.id });
  await revokeRecruitment({ recruitmentId: revokedId, actorUserId: ops.id });
  await assert.rejects(() => inspectRecruitment(revokedToken).then((result) => { if (result.status !== "revoked") throw new Error("Expected revoked"); }).then(() => acceptRecruitment(otherUserId, revokedToken, true)));

  const expiringToken = createInvitationToken();
  const [{ id: expiringId }] = await db.insert(campusRecruitments).values({ leadRepId: lead.id, campusId: lead.campusId, name: "Expiring Recruit", phoneE164: uniquePhone(), tokenHash: hashInvitationToken(expiringToken), expiresAt: new Date(Date.now() - 1000) }).returning({ id: campusRecruitments.id });
  const expiryRun = await runDurableJob("recruitment_expiry", "manual", `phase3-expiry-${crypto.randomUUID()}`);
  assert.equal(expiryRun.status, "succeeded");
  const [expired] = await db.select().from(campusRecruitments).where(eq(campusRecruitments.id, expiringId)).limit(1);
  assert.equal(expired.status, "expired");
  const duplicateSlot = `phase3-duplicate-${crypto.randomUUID()}`;
  const firstJob = await runDurableJob("draft_expiry", "schedule", duplicateSlot);
  const duplicateJob = await runDurableJob("draft_expiry", "schedule", duplicateSlot);
  assert.equal(firstJob.status, "succeeded");
  assert.equal(duplicateJob.status, "skipped_duplicate");

  const telemetry = await campusTelemetry();
  assert.equal(telemetry.length, 15);
  const unilag = telemetry.find((row) => row.campus.name === "University of Lagos")!;
  assert.ok(unilag.activeReps >= 3);
  assert.ok(unilag.activations >= 0);
  assert.ok(telemetry.every((row) => row.evidence === "derived_from_current_records"));

  const [historyEntry] = await db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.id)).limit(1);
  const [auditEntry] = await db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
  assert.ok(historyEntry && auditEntry);
  await assert.rejects(() => db.update(ledgerEntries).set({ amountKobo: historyEntry.amountKobo + 1 }).where(eq(ledgerEntries.id, historyEntry.id)));
  await assert.rejects(() => db.delete(auditLogs).where(eq(auditLogs.id, auditEntry.id)));
  const [unchangedEntry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, historyEntry.id)).limit(1);
  assert.equal(unchangedEntry.amountKobo, historyEntry.amountKobo);

  const deal = await makeDeal(activeRep.id, uniquePhone());
  await db.update(deals).set({ confirmAt: new Date(Date.now() - 1000) }).where(eq(deals.id, deal.id));
  await Promise.all([confirmDueDeals(), confirmDueDeals(), confirmDueDeals()]);
  const confirmationEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, deal.id));
  assert.equal(confirmationEntries.length, 5, "one direct commission group and one lead-override group");
  const [confirmedDeal] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
  assert.equal(confirmedDeal.state, "payable");

  const payoutRuns = await Promise.all(Array.from({ length: 5 }, () => runPayoutBatch(ops.id)));
  const newRepPayouts = await db.select().from(payouts).where(eq(payouts.repId, activeRep.id));
  assert.equal(newRepPayouts.length, 1, "concurrent batches must not double-pay the recruit");
  const paidResults = payoutRuns.flatMap((run) => run.results).filter((result) => result.repId === activeRep.id && result.status === "paid");
  assert.equal(paidResults.length, 1);
  const [paidDeal] = await db.select().from(deals).where(eq(deals.id, deal.id)).limit(1);
  assert.equal(paidDeal.state, "paid");
  const inbox = await listNotifications(recruitUserId);
  assert.ok(inbox.notifications.some((item) => item.type === "rep_activated"));
  assert.ok(inbox.notifications.some((item) => item.type === "payout_paid"));

  const [currentRule] = await db.select().from(commissionRules).where(and(eq(commissionRules.productId, product.id), isNull(commissionRules.supersededAt))).orderBy(desc(commissionRules.version)).limit(1);
  const economics = calculateRuleDryRun({ basis: "flat", flatAmountKobo: 120000, triggerEvent: "funded", recurrenceMonths: 1, confirmDays: 30, clawbackDays: 60 }, null);
  const [{ id: concurrentDraftId }] = await db.insert(commissionRuleDrafts).values({ productId: product.id, vendorId: vendor.id, createdByUserId: vendorUser.id, basis: economics.basis, pctBps: economics.pctBps, flatAmountKobo: economics.flatAmountKobo, triggerEvent: economics.triggerEvent, recurrenceMonths: 1, confirmDays: 30, clawbackDays: 60, sampleAmountKobo: null, vendorCommissionKobo: economics.vendorCommissionKobo, repCommissionKobo: economics.repCommissionKobo, platformFeeKobo: economics.platformFeeKobo, expiresAt: new Date(Date.now() + 30 * 60_000) }).returning({ id: commissionRuleDrafts.id });
  const publicationResults = await Promise.allSettled([publishRuleDraft(vendorUser.id, vendor.id, concurrentDraftId), publishRuleDraft(vendorUser.id, vendor.id, concurrentDraftId)]);
  assert.equal(publicationResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(publicationResults.filter((result) => result.status === "rejected").length, 1);
  const publishedVersions = await db.select().from(commissionRules).where(eq(commissionRules.productId, product.id));
  assert.equal(Math.max(...publishedVersions.map((rule) => rule.version)), currentRule.version + 1);
  assert.equal(publishedVersions.filter((rule) => !rule.supersededAt).length, 1);

  console.log(JSON.stringify({
    status: "passed",
    recruiting: { phoneBinding: true, rawTokenStored: false, acceptedThenActivated: true, assignmentCreated: true, revocation: true, expiryWorker: true },
    telemetry: { campuses: telemetry.length, derivedFromRecords: true, unilagActiveReps: unilag.activeReps },
    durability: { duplicateSlotSkipped: true, recruitmentJobRunId: expiryRun.runId },
    immutability: { ledgerUpdateRejected: true, auditDeleteRejected: true },
    concurrency: { confirmationLedgerEntries: confirmationEntries.length, concurrentPayoutBatches: payoutRuns.length, recruitPayouts: newRepPayouts.length, concurrentPublicationWinners: 1 },
    notifications: { activation: true, payout: true, unread: inbox.unread },
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
