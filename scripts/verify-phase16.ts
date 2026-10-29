import "dotenv/config";
import assert from "node:assert/strict";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  attributionRecords,
  campaignEnrollments,
  campaigns,
  campusRecruitments,
  commissionRules,
  deals,
  escrowWallets,
  fraudCases,
  ledgerEntries,
  products,
  promotionContactConsents,
  promotionEvents,
  promotionLinks,
  promotionOrchestrationEvents,
  promotionTriggerRules,
  reps,
  users,
  vendorEvents,
  vendorIngestionRetries,
  vendorPromotions,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { salesActorForUser, type SalesActor } from "../api/services/salesAccess";
import { completeSyntheticEnrollment } from "../api/services/assuranceFixtures";
import { completeSyntheticIdentityWorkflow } from "../api/services/identityFixtures";
import {
  changePromotionState,
  createPromotion,
  createPromotionLink,
  createPromotionRecruitmentInvite,
  listPromotionWorkspace,
  processPromotionOrchestration,
  recordPromotionConsent,
  requestPromotionDelivery,
  reviewPromotion,
  runPromotionScheduleSweep,
  setPromotionTrigger,
  submitPromotionReview,
} from "../api/services/promotions";
import { acceptRecruitment, activateRecruitment } from "../api/services/recruiting";
import { ingestVendorEvent, type VendorEventInput } from "../api/services/events";
import { confirmDueDeals, reverseDeal } from "../api/services/ledger";
import { createVendorService, testVendorService } from "../api/services/vendorServices";
import { scheduleIngestionRetry } from "../api/services/ingestionRetries";
import { reviewFraudCase } from "../api/services/fraud";
import { calculateVendorCommissionKobo, splitCommission } from "../api/services/money";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
let phoneCounter = 0;
const uniquePhone = () => `+23496${String(Date.now() + phoneCounter++).slice(-8)}`;
const eventPayload = (eventId: string, phone: string, token?: string): VendorEventInput => ({
  event_id: `${eventId}-${suffix}`,
  type: "funded",
  occurred_at: new Date().toISOString(),
  customer: { phone, customer_ref: `customer-${eventId}-${suffix}` },
  product_ref: "savings-01",
  amount_kobo: 500_000,
  meta: { source: "phase16-control-fixture", ...(token ? { kf_token: token } : {}) },
});
const tokenFromUrl = (url: string) => new URL(url).pathname.split("/p/")[1];

async function makeRecruit(input: { promotionId: number; leadActor: SalesActor; campusId: number; opsUserId: number; label: string }) {
  const phone = uniquePhone();
  const invited = await createPromotionRecruitmentInvite({ actor: input.leadActor, promotionId: input.promotionId, name: `Phase 16 ${input.label} ${suffix.slice(0, 5)}`, phone, note: "Synthetic consented candidate; no identity documents in this record.", consentConfirmed: true });
  const [user] = await db.insert(users).values({ phoneE164: phone, name: `Phase 16 ${input.label} ${suffix.slice(0, 5)}`, role: "rep", kycState: "verified", bankNameMatch: true, bankName: "Sandbox Bank", bankCode: "999", bankAccountLast4: String(1000 + phoneCounter).slice(-4), bankAccountName: `Phase 16 ${input.label}` }).returning();
  const token = new URL(`http://sandbox${invited.acceptancePath}`).searchParams.get("token")!;
  const accepted = await acceptRecruitment(user.id, token, true);
  await completeSyntheticIdentityWorkflow({ caseType: "representative_kyc", subjectType: "user", subjectId: user.id, requestUserId: user.id, reviewerUserId: input.opsUserId, campusId: input.campusId, triggerEvent: "phase16.recruitment_activation" });
  return { invited, accepted, user, phone };
}

async function main() {
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [activeRule] = await db.select().from(commissionRules).where(and(
    eq(commissionRules.productId, product.id),
    eq(commissionRules.triggerEvent, "funded"),
    isNull(commissionRules.supersededAt),
  )).orderBy(desc(commissionRules.version)).limit(1);
  assert.ok(activeRule);
  const expectedCommission = splitCommission(calculateVendorCommissionKobo(activeRule, 500_000));
  const mainBudgetKobo = expectedCommission.vendorCommissionKobo * 3;
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, product.vendorId)).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor.userId!)).limit(1);
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [lead] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [team] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [leadUser] = await db.select().from(users).where(eq(users.id, lead.userId)).limit(1);
  const [teamUser] = await db.select().from(users).where(eq(users.id, team.userId)).limit(1);
  const [financeUser] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000005")).limit(1);
  assert.ok(product && vendor && vendorUser && ops && lead && team && leadUser && teamUser && financeUser);
  // Earlier ordered journeys exercise tier changes; normalize the shared seed lead
  // so this promotion journey starts from the same accountable-lead fixture on
  // both a freshly seeded database and the full Phase 2–16 regression database.
  await db.update(reps).set({ tier: "campus_lead" }).where(eq(reps.id, lead.id));
  const vendorActor = await salesActorForUser(vendorUser);
  const opsActor = await salesActorForUser(ops);
  const leadActor = await salesActorForUser(leadUser);
  const teamActor = await salesActorForUser(teamUser);
  const [reviewerUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 16 Reviewer ${suffix.slice(0, 5)}`, role: "ops" }).returning();
  const reviewer = await salesActorForUser(reviewerUser);
  const financeActor = await salesActorForUser(financeUser);
  // Phase 8 deliberately leaves an open hold on this shared representative.
  // Release it through Operations before using the rep as a clean promotion
  // actor; the original case and release remain in append-only history.
  const inheritedTeamCases = await db.select().from(fraudCases).where(and(
    eq(fraudCases.repId, team.id),
    inArray(fraudCases.state, ["open", "appeal_open"]),
  ));
  for (const inheritedCase of inheritedTeamCases) {
    await reviewFraudCase({
      caseId: inheritedCase.id,
      actorUserId: reviewerUser.id,
      decision: "release",
      conductAction: "strike",
      note: "Release the earlier-phase control hold before the independent Phase 16 journey.",
    });
  }
  await completeSyntheticEnrollment({ userId: leadUser.id, reviewerUserId: ops.id });
  await completeSyntheticEnrollment({ userId: teamUser.id, reviewerUserId: ops.id });
  const startsAt = new Date(Date.now() - 60_000);
  const endsAt = new Date(Date.now() + 7 * 86_400_000);

  // Vendor self-service and Operations four-eyes review.
  const vendorDraft = await createPromotion({ actor: vendorActor, name: `Vendor self-service ${suffix.slice(0, 6)}`, productId: product.id, campusId: lead.campusId, brief: "Vendor-authored customer promotion brief with explicit verified activation evidence and no income guarantee.", budgetCapKobo: 500_000, recruitmentTarget: 3, staffingWarningPct: 80, startsAt, endsAt });
  assert.equal(vendorDraft.state, "draft");
  assert.equal(vendorDraft.escrowReserved, false);
  await submitPromotionReview({ actor: vendorActor, promotionId: vendorDraft.promotionId, expectedVersion: 1 });
  assert.equal((await db.select().from(promotionTriggerRules).where(eq(promotionTriggerRules.promotionId, vendorDraft.promotionId))).length, 8);

  const main = await createPromotion({ actor: opsActor, name: `Phase 16 main ${suffix.slice(0, 6)}`, productId: product.id, campusId: lead.campusId, brief: "External savings promotion that triggers controlled campus recruitment and signed first-touch customer acquisition.", budgetCapKobo: mainBudgetKobo, recruitmentTarget: 2, staffingWarningPct: 80, startsAt, endsAt });
  await submitPromotionReview({ actor: opsActor, promotionId: main.promotionId, expectedVersion: 1 });
  await assert.rejects(() => reviewPromotion({ actor: opsActor, promotionId: main.promotionId, decision: "approved", note: "Self approval must fail" }), /Independent review/);
  await reviewPromotion({ actor: reviewer, promotionId: main.promotionId, decision: "approved", note: "Independent review of claims, staffing, budget and privacy controls." });
  let [mainRow] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, main.promotionId)).limit(1);
  assert.ok(mainRow.recruitmentCampaignId);
  const [child] = await db.select().from(campaigns).where(eq(campaigns.id, mainRow.recruitmentCampaignId!)).limit(1);
  assert.equal(child.state, "approved");
  assert.equal(child.goal, "recruitment");
  await runPromotionScheduleSweep();
  [mainRow] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, main.promotionId)).limit(1);
  assert.equal(mainRow.state, "active");
  const enrollments = await db.select({ repTier: reps.tier }).from(campaignEnrollments).innerJoin(reps, eq(campaignEnrollments.repId, reps.id)).where(eq(campaignEnrollments.campaignId, child.id));
  assert.ok(enrollments.length >= 1);
  assert.ok(enrollments.every((row) => row.repTier === "campus_lead"));

  // Recruitment alone creates no deal; target met stops only new invitations.
  const recruitmentFinancialBefore = await db.select({ id: deals.id }).from(deals);
  const firstRecruit = await makeRecruit({ promotionId: main.promotionId, leadActor, campusId: lead.campusId, opsUserId: ops.id, label: "recruit-one" });
  await activateRecruitment(firstRecruit.invited.recruitmentId, ops.id);
  const secondRecruit = await makeRecruit({ promotionId: main.promotionId, leadActor, campusId: lead.campusId, opsUserId: ops.id, label: "recruit-two" });
  const openThird = await createPromotionRecruitmentInvite({ actor: leadActor, promotionId: main.promotionId, name: `Existing onboarding ${suffix.slice(0, 5)}`, phone: uniquePhone(), consentConfirmed: true });
  await activateRecruitment(secondRecruit.invited.recruitmentId, ops.id);
  await processPromotionOrchestration();
  [mainRow] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, main.promotionId)).limit(1);
  assert.ok(mainRow.targetMetAt);
  const [pausedChild] = await db.select().from(campaigns).where(eq(campaigns.id, child.id)).limit(1);
  assert.equal(pausedChild.state, "paused");
  await assert.rejects(() => createPromotionRecruitmentInvite({ actor: leadActor, promotionId: main.promotionId, name: "Blocked extra recruit", phone: uniquePhone(), consentConfirmed: true }), /not accepting new invitations|target/);
  const [preservedOnboarding] = await db.select().from(campusRecruitments).where(eq(campusRecruitments.id, openThird.recruitmentId)).limit(1);
  assert.equal(preservedOnboarding.status, "invited");
  const recruitmentFinancialAfter = await db.select({ id: deals.id }).from(deals);
  assert.deepEqual(recruitmentFinancialAfter, recruitmentFinancialBefore);

  // Signed links contain no customer data and persist only token hashes.
  const mainLink = await createPromotionLink({ actor: leadActor, promotionId: main.promotionId, origin: "http://127.0.0.1:3000" });
  const mainToken = tokenFromUrl(mainLink.url);
  assert.ok(mainLink.qr.startsWith("data:image/png;base64,"));
  assert.ok(!mainLink.url.includes("phone") && !mainLink.url.includes("customer"));
  const [storedMainLink] = await db.select().from(promotionLinks).where(eq(promotionLinks.id, mainLink.linkId)).limit(1);
  assert.notEqual(storedMainLink.tokenHash, mainToken);
  assert.ok(!JSON.stringify(storedMainLink).includes(mainToken));

  // A competing promotion cannot reassign an existing first touch.
  const second = await createPromotion({ actor: opsActor, name: `Competing promotion ${suffix.slice(0, 6)}`, productId: product.id, campusId: lead.campusId, brief: "A separately approved promotion used to prove first-touch preservation and lifecycle propagation.", budgetCapKobo: 1_000_000, recruitmentTarget: 1, staffingWarningPct: 80, startsAt, endsAt });
  await submitPromotionReview({ actor: opsActor, promotionId: second.promotionId, expectedVersion: 1 });
  await reviewPromotion({ actor: reviewer, promotionId: second.promotionId, decision: "approved", note: "Independent competing-promotion control review." });
  await runPromotionScheduleSweep();
  const secondLink = await createPromotionLink({ actor: teamActor, promotionId: second.promotionId, origin: "http://127.0.0.1:3000" });
  const secondToken = tokenFromUrl(secondLink.url);

  const firstCustomer = uniquePhone();
  const firstAccepted = await ingestVendorEvent(vendor.webhookKey, eventPayload("first", firstCustomer, mainToken));
  assert.equal(firstAccepted.status, "accepted");
  assert.equal(firstAccepted.promotion_id, main.promotionId);
  const duplicate = await ingestVendorEvent(vendor.webhookKey, eventPayload("first", firstCustomer, mainToken));
  assert.equal(duplicate.status, "duplicate");
  const firstTouchRepeat = await ingestVendorEvent(vendor.webhookKey, eventPayload("competing-token", firstCustomer, secondToken));
  assert.equal(firstTouchRepeat.status, "accepted");
  assert.equal(firstTouchRepeat.promotion_id, main.promotionId);
  const [repeatDeal] = await db.select().from(deals).where(eq(deals.id, firstTouchRepeat.deal_id!)).limit(1);
  const [firstAttribution] = await db.select().from(attributionRecords).where(eq(attributionRecords.id, repeatDeal.attributionId)).limit(1);
  assert.equal(firstAttribution.repId, lead.id);
  assert.equal(firstAttribution.promotionId, main.promotionId);

  // Two concurrent submissions race for the final single-commission budget slot; exactly one is accepted.
  const race = await Promise.all([
    ingestVendorEvent(vendor.webhookKey, eventPayload("race-a", uniquePhone(), mainToken)),
    ingestVendorEvent(vendor.webhookKey, eventPayload("race-b", uniquePhone(), mainToken)),
  ]);
  assert.equal(race.filter((result) => result.status === "accepted").length, 1);
  assert.equal(race.filter((result) => result.status === "quarantined").length, 1);
  const mainAttributions = await db.select({ id: attributionRecords.id }).from(attributionRecords).where(eq(attributionRecords.promotionId, main.promotionId));
  const mainDeals = await db.select().from(deals).where(inArray(deals.attributionId, mainAttributions.map((row) => row.id)));
  assert.equal(mainDeals.length, 3);
  assert.equal(mainDeals.reduce((sum, deal) => sum + deal.vendorCommissionKobo, 0), mainBudgetKobo);
  const ledgerBeforeBlocked = await db.select().from(ledgerEntries);
  const blocked = await ingestVendorEvent(vendor.webhookKey, eventPayload("over-budget", uniquePhone(), mainToken));
  assert.equal(blocked.status, "quarantined");
  assert.equal(blocked.escrowDebited, false);
  await processPromotionOrchestration();
  [mainRow] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, main.promotionId)).limit(1);
  assert.equal(mainRow.state, "budget_exhausted");
  assert.deepEqual(await db.select().from(ledgerEntries), ledgerBeforeBlocked);
  await assert.rejects(() => createPromotionLink({ actor: leadActor, promotionId: main.promotionId, origin: "http://127.0.0.1:3000" }), /not active/);

  // Confirmed outcomes retain 80/20 economics and emit durable reporting events.
  const firstDealId = firstAccepted.deal_id!;
  await db.update(deals).set({ confirmAt: new Date(Date.now() - 1000) }).where(eq(deals.id, firstDealId));
  const confirmed = await confirmDueDeals(ops.id);
  assert.ok(confirmed.confirmed >= 1);
  const [confirmedDeal] = await db.select().from(deals).where(eq(deals.id, firstDealId)).limit(1);
  assert.equal(confirmedDeal.state, "payable");
  assert.equal(confirmedDeal.vendorCommissionKobo, expectedCommission.vendorCommissionKobo);
  assert.equal(confirmedDeal.repCommissionKobo, expectedCommission.repCommissionKobo);
  assert.equal(confirmedDeal.platformFeeKobo, expectedCommission.platformFeeKobo);
  const confirmationEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, firstDealId));
  assert.equal(confirmationEntries.reduce((sum, entry) => sum + (entry.direction === "credit" ? entry.amountKobo : -entry.amountKobo), 0), 0);
  await processPromotionOrchestration();
  assert.ok((await db.select().from(promotionOrchestrationEvents).where(eq(promotionOrchestrationEvents.eventKey, `activation-confirmed:${firstDealId}`))).length === 1);

  // Pause/resume propagation, trigger administration, consent suppression and retry privacy.
  await changePromotionState({ actor: vendorActor, promotionId: second.promotionId, action: "pause" });
  let [secondRow] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, second.promotionId)).limit(1);
  assert.equal(secondRow.state, "paused");
  const [secondChildPaused] = await db.select().from(campaigns).where(eq(campaigns.id, secondRow.recruitmentCampaignId!)).limit(1);
  assert.equal(secondChildPaused.state, "paused");
  await assert.rejects(() => createPromotionLink({ actor: teamActor, promotionId: second.promotionId, origin: "http://127.0.0.1:3000" }), /not active/);
  await changePromotionState({ actor: reviewer, promotionId: second.promotionId, action: "resume" });
  const [pauseRule] = await db.select().from(promotionTriggerRules).where(and(eq(promotionTriggerRules.promotionId, second.promotionId), eq(promotionTriggerRules.eventType, "promotion.paused"))).limit(1);
  await setPromotionTrigger({ actor: reviewer, ruleId: pauseRule.id, enabled: false });
  await setPromotionTrigger({ actor: reviewer, ruleId: pauseRule.id, enabled: true });

  const rawCustomerRef = `raw-consent-${suffix}`;
  await recordPromotionConsent({ actor: vendorActor, promotionId: second.promotionId, customerRef: rawCustomerRef, channel: "email", state: "consented", evidenceRef: "consent-evidence-primary", policyVersion: "privacy-v1.0" });
  await recordPromotionConsent({ actor: vendorActor, promotionId: second.promotionId, customerRef: rawCustomerRef, channel: "email", state: "suppressed", evidenceRef: "suppression-evidence-primary", policyVersion: "privacy-v1.0" });
  await recordPromotionConsent({ actor: vendorActor, promotionId: second.promotionId, customerRef: `other-${suffix}`, channel: "email", state: "consented", evidenceRef: "consent-evidence-secondary", policyVersion: "privacy-v1.0" });
  const storedConsents = await db.select().from(promotionContactConsents).where(eq(promotionContactConsents.promotionId, second.promotionId));
  assert.ok(!JSON.stringify(storedConsents).includes(rawCustomerRef));
  assert.equal(storedConsents.filter((row) => row.state === "suppressed").length, 1);
  const messaging = await createVendorService({ actor: vendorActor, vendorId: vendor.id, service: "messaging", displayName: `Phase 16 sandbox messaging ${suffix.slice(0, 4)}`, mode: "sandbox" });
  await testVendorService({ actor: vendorActor, connectionId: messaging.connectionId });
  const simulated = await requestPromotionDelivery({ actor: vendorActor, promotionId: second.promotionId, channel: "email", mode: "sandbox" });
  assert.equal(simulated.state, "simulated");
  assert.equal(simulated.externalRequestMade, false);
  assert.equal(simulated.liveDeliveryClaimed, false);
  await assert.rejects(() => requestPromotionDelivery({ actor: vendorActor, promotionId: second.promotionId, channel: "email", mode: "live" }));
  const retry = await scheduleIngestionRetry(vendor.webhookKey, eventPayload("retry-privacy", uniquePhone(), secondToken), "ECONNRESET");
  const [storedRetry] = await db.select().from(vendorIngestionRetries).where(eq(vendorIngestionRetries.id, retry.retryId)).limit(1);
  assert.equal(storedRetry.promotionLinkId, secondLink.linkId);
  assert.ok(!JSON.stringify(storedRetry.payloadJson).includes(secondToken));

  // Escrow capacity includes every vendor-pending commitment and never double-reserves confirmed deals.
  const third = await createPromotion({ actor: opsActor, name: `Escrow control ${suffix.slice(0, 6)}`, productId: product.id, campusId: lead.campusId, brief: "Capacity-control promotion proving that all pending vendor commitments reduce acquisition headroom.", budgetCapKobo: 10_000_000, recruitmentTarget: 1, staffingWarningPct: 80, startsAt, endsAt });
  await submitPromotionReview({ actor: opsActor, promotionId: third.promotionId, expectedVersion: 1 });
  await reviewPromotion({ actor: reviewer, promotionId: third.promotionId, decision: "approved", note: "Independent escrow-capacity control review." });
  await runPromotionScheduleSweep();
  const thirdLink = await createPromotionLink({ actor: leadActor, promotionId: third.promotionId, origin: "http://127.0.0.1:3000" });
  const thirdToken = tokenFromUrl(thirdLink.url);
  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  const originalWalletBalance = wallet.balanceKobo;
  await db.update(escrowWallets).set({ balanceKobo: 250_000 }).where(eq(escrowWallets.vendorId, vendor.id));
  const escrowBlocked = await ingestVendorEvent(vendor.webhookKey, eventPayload("escrow-depleted", uniquePhone(), thirdToken));
  assert.equal(escrowBlocked.status, "quarantined");
  assert.match(escrowBlocked.reason || "", /escrow/i);
  assert.equal(escrowBlocked.ledgerEntriesCreated, 0);
  await db.update(escrowWallets).set({ balanceKobo: originalWalletBalance }).where(eq(escrowWallets.vendorId, vendor.id));

  // Role-scoped reporting and Finance oversight expose no mutation capability.
  const vendorWorkspace = await listPromotionWorkspace(vendorActor);
  assert.ok(vendorWorkspace.promotions.every((row) => row.promotion.vendorId === vendor.id));
  assert.ok(vendorWorkspace.promotions.find((row) => row.promotion.id === main.promotionId)?.report.budget);
  const repWorkspace = await listPromotionWorkspace(leadActor);
  assert.ok(repWorkspace.promotions.every((row) => row.report.budget === null));
  assert.ok(repWorkspace.events.every((event) => Object.keys(event.metadataJson).length === 0));
  const financeWorkspace = await listPromotionWorkspace(financeActor);
  assert.ok(financeWorkspace.promotions.every((row) => Object.values(row.capabilities).every((allowed) => !allowed)));
  await assert.rejects(() => createPromotion({ actor: financeActor, name: "Finance cannot draft", productId: product.id, brief: "Finance read-only role must not create promotion records.", budgetCapKobo: 100_000, recruitmentTarget: 1, staffingWarningPct: 80, startsAt, endsAt }), /workspace role/);

  // End propagation revokes links and preserves verified history; refunds still claw back.
  await changePromotionState({ actor: reviewer, promotionId: second.promotionId, action: "end" });
  [secondRow] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, second.promotionId)).limit(1);
  assert.equal(secondRow.state, "completed");
  const [revokedSecondLink] = await db.select().from(promotionLinks).where(eq(promotionLinks.id, secondLink.linkId)).limit(1);
  assert.equal(revokedSecondLink.state, "revoked");
  const ledgerBeforeReversal = await db.select().from(ledgerEntries);
  const reversed = await reverseDeal(firstDealId, "phase16:refund-control");
  assert.equal(reversed.reversed, true);
  const [voidDeal] = await db.select().from(deals).where(eq(deals.id, firstDealId)).limit(1);
  assert.equal(voidDeal.state, "void");
  assert.ok((await db.select().from(ledgerEntries).where(eq(ledgerEntries.dealId, firstDealId))).length > ledgerBeforeReversal.filter((entry) => entry.dealId === firstDealId).length);

  // Time-adjusted staffing risk, commercial-status propagation and automatic closure fail closed without rewriting finance.
  const ledgerBeforeLifecycle = await db.select().from(ledgerEntries);
  const staffingRisk = await createPromotion({ actor: opsActor, name: `Staffing risk ${suffix.slice(0, 6)}`, productId: product.id, campusId: lead.campusId, brief: "Time-adjusted recruitment staffing control with no activated recruits at the configured warning threshold.", budgetCapKobo: 1_000_000, recruitmentTarget: 1, staffingWarningPct: 80, startsAt, endsAt });
  await submitPromotionReview({ actor: opsActor, promotionId: staffingRisk.promotionId, expectedVersion: 1 });
  await reviewPromotion({ actor: reviewer, promotionId: staffingRisk.promotionId, decision: "approved", note: "Independent staffing-risk orchestration review." });
  await db.update(vendorPromotions).set({ startsAt: new Date(Date.now() - 8 * 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000) }).where(eq(vendorPromotions.id, staffingRisk.promotionId));
  await runPromotionScheduleSweep();
  await runPromotionScheduleSweep();
  const [riskEvent] = await db.select().from(promotionOrchestrationEvents).where(eq(promotionOrchestrationEvents.eventKey, `promotion:${staffingRisk.promotionId}:recruitment-at-risk:${new Date().toISOString().slice(0, 10)}`)).limit(1);
  assert.equal(riskEvent?.state, "processed");

  await changePromotionState({ actor: reviewer, promotionId: third.promotionId, action: "resume" });
  await db.update(vendors).set({ status: "paused" }).where(eq(vendors.id, vendor.id));
  await assert.rejects(() => createPromotionRecruitmentInvite({ actor: leadActor, promotionId: third.promotionId, name: "Blocked inactive vendor recruit", phone: uniquePhone(), consentConfirmed: true }), /vendor and product must both be active/);
  await assert.rejects(() => createPromotionLink({ actor: leadActor, promotionId: third.promotionId, origin: "http://127.0.0.1:3000" }), /vendor and product must both be active/);
  await runPromotionScheduleSweep();
  const [commercialPaused] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, third.promotionId)).limit(1);
  assert.equal(commercialPaused.state, "paused");
  const [commercialPausedChild] = await db.select().from(campaigns).where(eq(campaigns.id, commercialPaused.recruitmentCampaignId!)).limit(1);
  assert.equal(commercialPausedChild.state, "paused");
  await db.update(vendors).set({ status: "active" }).where(eq(vendors.id, vendor.id));
  await changePromotionState({ actor: reviewer, promotionId: third.promotionId, action: "resume" });
  await db.update(vendorPromotions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(vendorPromotions.id, third.promotionId));
  await runPromotionScheduleSweep();
  const [automaticallyEnded] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, third.promotionId)).limit(1);
  assert.equal(automaticallyEnded.state, "completed");
  const [revokedThirdLink] = await db.select().from(promotionLinks).where(eq(promotionLinks.id, thirdLink.linkId)).limit(1);
  assert.equal(revokedThirdLink.state, "revoked");
  assert.deepEqual(await db.select().from(ledgerEntries), ledgerBeforeLifecycle);

  // No raw signed token or customer identifier leaked into webhook/retry persistence.
  const allEvents = await db.select().from(vendorEvents).where(inArray(vendorEvents.id, [firstAccepted.kf_event_id, firstTouchRepeat.kf_event_id, blocked.kf_event_id, escrowBlocked.kf_event_id]));
  for (const event of allEvents) {
    assert.ok(!JSON.stringify(event.payloadJson).includes(mainToken));
    assert.ok(!JSON.stringify(event.payloadJson).includes(secondToken));
    assert.ok(!JSON.stringify(event.payloadJson).includes(thirdToken));
    assert.ok(!JSON.stringify(event.payloadJson).includes(firstCustomer));
  }
  assert.ok((await db.select().from(promotionEvents).where(eq(promotionEvents.promotionId, main.promotionId))).some((event) => event.eventType === "recruitment.target_met"));
  console.log(JSON.stringify({
    phase: 16,
    status: "passed",
    independentReview: true,
    linkedRecruitmentCampaign: true,
    campusLeadsOnly: true,
    recruitmentTargetMet: 2,
    existingOnboardingPreserved: true,
    firstTouchPreserved: true,
    concurrentBudgetRace: "one accepted, one quarantined",
    escrowDepletionBlocked: true,
    confirmedEconomics: "80/20 preserved",
    refundClawbackPreserved: true,
    staffingAtRiskEvent: true,
    inactiveVendorPropagation: true,
    automaticScheduleClosure: true,
    lifecycleFinancialPreservation: true,
    rawTokenPersistence: false,
    externalDelivery: "sandbox simulation only",
    financeReadOnly: true,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
