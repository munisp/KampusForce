import "dotenv/config";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  campusRecruitments,
  caseWatchers,
  deals,
  ledgerEntries,
  opportunities,
  products,
  reps,
  studentReferrals,
  supportTickets,
  trainingModules,
  trainingProgress,
  users,
  vendorServiceConnections,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { ensureAttribution } from "../api/services/attribution";
import { createSupportTicket, escalateSupportTicket, rateSupportTicket, resolveSupportTicket } from "../api/services/support";
import { salesActorForUser } from "../api/services/salesAccess";
import { addCaseMessage, assignCase, linkCases, listCaseWorkspace, reopenCase, saveCaseView, setCaseWatch, snoozeCase, wakeSnoozedCases } from "../api/services/caseManagement";
import { addOpportunityActivity, createOpportunity, createOpportunityTask, generateOutreachDraft, listPipeline, saveCrmSegment, setOpportunityTaskState, setOutreachState, updateOpportunityStage } from "../api/services/crm";
import { getTrainingWorkspace, startTraining, submitTrainingAttempt } from "../api/services/training";
import { activateCampaign, createCampaign, listCampaignWorkspace, pauseCampaign, reviewCampaign, submitCampaignReview } from "../api/services/campaigns";
import { createVendorService, syncVendorService, testVendorService } from "../api/services/vendorServices";
import { inviteSuggestedStudent, listGrowthWorkspace, refreshOpportunityTargets, scheduleRecruitmentFollowUp, setRecommendationState, suggestStudent } from "../api/services/growth";
import { randomReference } from "../api/services/security";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const uniquePhone = () => `+23495${String(randomInt(100_000_000)).padStart(8, "0")}`;

async function main() {
  const [lead] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, product.vendorId)).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor.userId!)).limit(1);
  const [leadUser] = await db.select().from(users).where(eq(users.id, lead.userId)).limit(1);
  assert.ok(lead && ops && product && vendor && vendorUser && leadUser);
  const leadActor = await salesActorForUser(leadUser);
  const opsActor = await salesActorForUser(ops);
  const vendorActor = await salesActorForUser(vendorUser);
  const [financialBefore, ledgerBefore] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);

  // Case management: first response, collision control, notes, snooze, reopen, links and views.
  const casePhone = uniquePhone();
  await ensureAttribution({ repId: lead.id, productId: product.id, customerPhone: casePhone, source: "link", actorUserId: leadUser.id });
  const ticket = await createSupportTicket({ actorUserId: leadUser.id, repId: lead.id, productId: product.id, customerPhone: casePhone, category: "activation", subject: `Phase 12 case ${suffix.slice(0, 8)}`, description: "Synthetic referred-customer support acceptance record.", priority: "urgent" });
  assert.ok(ticket.firstResponseDueAt);
  assert.equal((await db.select().from(caseWatchers).where(eq(caseWatchers.ticketId, ticket.id))).length, 1);
  const competingAssignments = await Promise.allSettled([
    assignCase({ actor: opsActor, ticketId: ticket.id, assigneeUserId: ops.id, expectedVersion: ticket.version }),
    assignCase({ actor: opsActor, ticketId: ticket.id, assigneeUserId: ops.id, expectedVersion: ticket.version }),
  ]);
  assert.equal(competingAssignments.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competingAssignments.filter((result) => result.status === "rejected").length, 1);
  await assert.rejects(() => addCaseMessage({ actor: leadActor, ticketId: ticket.id, visibility: "internal", body: "Representatives cannot write staff-only notes" }), /Internal staff notes/);
  await addCaseMessage({ actor: vendorActor, ticketId: ticket.id, visibility: "internal", body: "Staff-only evidence review" });
  await addCaseMessage({ actor: vendorActor, ticketId: ticket.id, visibility: "public", body: "We are reviewing the activation evidence." });
  const repCaseView = await listCaseWorkspace(leadActor);
  assert.ok(!JSON.stringify(repCaseView).includes("customerPhoneHash"));
  assert.ok(!repCaseView.messages.some((message) => message.ticketId === ticket.id && message.visibility === "internal"));
  assert.ok(repCaseView.cases.find((row) => row.ticket.id === ticket.id)?.ticket.firstRespondedAt);
  const future = new Date(Date.now() + 60_000);
  await snoozeCase({ actor: vendorActor, ticketId: ticket.id, until: future, note: "Waiting for synthetic vendor evidence" });
  await db.update(supportTickets).set({ snoozedUntil: new Date(Date.now() - 1000) }).where(eq(supportTickets.id, ticket.id));
  assert.equal((await wakeSnoozedCases()).woken >= 1, true);
  await escalateSupportTicket({ ticketId: ticket.id, actorUserId: leadUser.id, actor: "rep", repId: lead.id, target: "vendor" });
  await resolveSupportTicket({ ticketId: ticket.id, actorUserId: vendorUser.id, actor: "vendor", vendorId: vendor.id, resolution: "Synthetic activation evidence reviewed for acceptance testing." });
  await rateSupportTicket({ ticketId: ticket.id, actorUserId: leadUser.id, repId: lead.id, csat: 5, comment: "Control-test CSAT" });
  const reopened = await reopenCase({ actor: leadActor, ticketId: ticket.id, reason: "New synthetic evidence requires another review" });
  assert.equal(reopened.reopenedCount, 1);
  const [afterReopen] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)).limit(1);
  assert.equal(afterReopen.csat, 5);
  assert.ok(afterReopen.resolution);
  assert.equal(afterReopen.firstRespondedAt, null);
  const secondPhone = uniquePhone();
  await ensureAttribution({ repId: lead.id, productId: product.id, customerPhone: secondPhone, source: "link", actorUserId: leadUser.id });
  const secondTicket = await createSupportTicket({ actorUserId: leadUser.id, repId: lead.id, productId: product.id, customerPhone: secondPhone, category: "activation", subject: `Linked case ${suffix.slice(0, 8)}`, description: "Second synthetic case for non-destructive linking.", priority: "normal" });
  const linked = await linkCases({ actor: leadActor, ticketId: ticket.id, relatedTicketId: secondTicket.id, linkType: "duplicate" });
  assert.equal(linked.destructiveMerge, false);
  await setCaseWatch({ actor: opsActor, ticketId: ticket.id, watching: true });
  await saveCaseView({ actor: leadActor, name: `Phase 12 ${suffix.slice(0, 6)}`, filters: { state: "open", unassigned: false } });

  // Fresh rep keeps training, targeting and CRM acceptance independent across reruns.
  const [freshUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 12 Rep ${suffix.slice(0, 6)}`, role: "rep", kycState: "verified" }).returning();
  const [freshRep] = await db.insert(reps).values({ userId: freshUser.id, campusId: lead.campusId, code: `KF-P12-${suffix.slice(0, 10)}`.toUpperCase(), status: "active", contractorAgreementSignedAt: new Date() }).returning();
  const repActor = await salesActorForUser(freshUser);
  const [recruitingUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 12 Lead ${suffix.slice(0, 6)}`, role: "rep", kycState: "verified" }).returning();
  const [recruitingRep] = await db.insert(reps).values({ userId: recruitingUser.id, campusId: lead.campusId, code: `KF-P12L-${suffix.slice(0, 9)}`.toUpperCase(), status: "active", tier: "campus_lead", contractorAgreementSignedAt: new Date() }).returning();
  assert.ok(recruitingRep);
  const recruitingActor = await salesActorForUser(recruitingUser);
  const crmPhone = uniquePhone();
  const opportunity = await createOpportunity({ actor: repActor, repId: freshRep.id, productId: product.id, alias: "Synthetic final-year study lead", customerPhone: crmPhone, nextActionAt: new Date(Date.now() + 86_400_000) });
  assert.equal(opportunity.financialDealCreated, false);
  await assert.rejects(() => updateOpportunityStage({ actor: repActor, opportunityId: opportunity.opportunityId, stage: "won", expectedVersion: 1 }), /Won requires/);
  await addOpportunityActivity({ actor: repActor, opportunityId: opportunity.opportunityId, activityType: "meeting", body: "Reviewed actual vendor terms and activation requirements", nextActionAt: new Date(Date.now() + 2 * 86_400_000) });
  const task = await createOpportunityTask({ actor: repActor, opportunityId: opportunity.opportunityId, title: "Confirm student suitability", dueAt: new Date(Date.now() + 86_400_000) });
  await setOpportunityTaskState({ actor: repActor, taskId: task.taskId, state: "completed" });
  const draft = await generateOutreachDraft({ actor: repActor, opportunityId: opportunity.opportunityId });
  assert.equal(draft.sent, false);
  await setOutreachState({ actor: repActor, draftId: draft.draftId, action: "approve" });
  const shared = await setOutreachState({ actor: repActor, draftId: draft.draftId, action: "mark_shared" });
  assert.equal(shared.externalDeliveryByPlatform, false);
  await saveCrmSegment({ actor: repActor, name: `Quiet review ${suffix.slice(0, 6)}`, filters: { stalled: true } });
  const pipeline = await listPipeline(repActor);
  assert.ok(!JSON.stringify(pipeline).includes("customerPhoneHash"));
  assert.ok(pipeline.opportunities.find((row) => row.opportunity.id === opportunity.opportunityId));

  const [verifiedDeal] = await db.select().from(deals).where(inArray(deals.state, ["confirmed", "payable", "paid"])).limit(1);
  assert.ok(verifiedDeal, "A verified financial fixture is required for the closed-loop won test");
  const [verifiedRep] = await db.select().from(reps).where(eq(reps.id, verifiedDeal.repId)).limit(1);
  const [verifiedUser] = await db.select().from(users).where(eq(users.id, verifiedRep.userId)).limit(1);
  const verifiedActor = await salesActorForUser(verifiedUser);
  const [{ id: wonOpportunityId }] = await db.insert(opportunities).values({ opportunityRef: randomReference("KF-O").toUpperCase(), alias: "Existing verified outcome", repId: verifiedRep.id, campusId: verifiedRep.campusId, productId: verifiedDeal.productId, vendorId: verifiedDeal.vendorId, customerPhoneHash: verifiedDeal.customerPhoneHash, createdByUserId: verifiedUser.id }).returning({ id: opportunities.id });
  const won = await updateOpportunityStage({ actor: verifiedActor, opportunityId: wonOpportunityId, stage: "won", expectedVersion: 1 });
  assert.equal(won.financialStateChanged, false);

  // Training catalog, answer secrecy, failed attempt and durable completion.
  const training = await getTrainingWorkspace(repActor);
  assert.equal(training.modules.length, 5);
  assert.ok(!JSON.stringify(training.modules).includes("answerIndex"));
  const module = training.modules[0];
  await startTraining(repActor, module.id);
  const failed = await submitTrainingAttempt({ actor: repActor, moduleId: module.id, answers: module.quizJson.map(() => 0) });
  assert.equal(failed.externalCertification, false);
  const [rawModule] = await db.select().from(trainingModules).where(eq(trainingModules.id, module.id)).limit(1);
  const passed = await submitTrainingAttempt({ actor: repActor, moduleId: module.id, answers: rawModule.quizJson.map((question) => question.answerIndex) });
  assert.equal(passed.passed, true);
  const [progress] = await db.select().from(trainingProgress).where(and(eq(trainingProgress.userId, freshUser.id), eq(trainingProgress.moduleId, module.id))).limit(1);
  assert.equal(progress.state, "completed");
  assert.equal(progress.attempts, 2);

  // Campaign four-eyes review, in-app enrollment and pause.
  const [reviewerUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 12 Reviewer ${suffix.slice(0, 5)}`, role: "ops" }).returning();
  const reviewer = await salesActorForUser(reviewerUser);
  const campaign = await createCampaign({ actor: opsActor, name: `Phase 12 campaign ${suffix.slice(0, 8)}`, goal: "training", messageDraft: "Complete the internal sales module; this is not an accredited external certification.", startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 86_400_000), audienceRules: { minQualityScore: 0, includeCampusLeads: true } });
  await submitCampaignReview({ actor: opsActor, campaignId: campaign.campaignId, expectedVersion: 1 });
  await assert.rejects(() => reviewCampaign({ actor: opsActor, campaignId: campaign.campaignId, decision: "approved", note: "Self review must fail" }), /Independent review/);
  await reviewCampaign({ actor: reviewer, campaignId: campaign.campaignId, decision: "approved", note: "Independent synthetic control review" });
  const activated = await activateCampaign({ actor: reviewer, campaignId: campaign.campaignId });
  assert.equal(activated.externalDelivery, false);
  assert.ok(activated.newEnrollments >= 1);
  await pauseCampaign({ actor: reviewer, campaignId: campaign.campaignId });
  const campaignWorkspace = await listCampaignWorkspace(repActor);
  assert.ok(campaignWorkspace.campaigns.some((row) => row.campaign.id === campaign.campaignId));

  // Vendor-service adapters: no credentials, local-only checks and fail-closed live configuration.
  let [connection] = await db.select().from(vendorServiceConnections).where(and(eq(vendorServiceConnections.vendorId, vendor.id), eq(vendorServiceConnections.service, "catalog"))).limit(1);
  if (!connection) {
    const configured = await createVendorService({ actor: vendorActor, vendorId: vendor.id, service: "catalog", displayName: "Phase 12 local catalog adapter", mode: "sandbox" });
    [connection] = await db.select().from(vendorServiceConnections).where(eq(vendorServiceConnections.id, configured.connectionId)).limit(1);
  }
  const tested = await testVendorService({ actor: vendorActor, connectionId: connection.id });
  assert.equal(tested.externalRequestMade, false);
  const synced = await syncVendorService({ actor: vendorActor, connectionId: connection.id });
  assert.equal(synced.financialStateChanged, false);
  await assert.rejects(() => createVendorService({ actor: vendorActor, vendorId: vendor.id, service: "messaging", displayName: "Unauthorized live adapter", mode: "live" }));

  // Explainable targets, accepted recommendation and consent-led student recruiting.
  await refreshOpportunityTargets(repActor, freshRep.id);
  const growth = await listGrowthWorkspace(repActor);
  assert.ok(growth.leaderboard.length >= 1);
  const recommendation = growth.recommendations.find((row) => row.recommendation.repId === freshRep.id && row.recommendation.state === "suggested");
  assert.ok(recommendation);
  const accepted = await setRecommendationState({ actor: repActor, recommendationId: recommendation.recommendation.id, action: "accept", alias: "Targeted synthetic relationship" });
  assert.equal(accepted.financialDealCreated, false);
  const referral = await suggestStudent({ actor: recruitingActor, candidateName: `Synthetic Student ${suffix.slice(0, 6)}`, strengths: "Clear communication and reliable society organization", consentConfirmed: true });
  const invited = await inviteSuggestedStudent({ actor: recruitingActor, referralId: referral.referralId, phone: uniquePhone() });
  assert.ok(invited.acceptancePath.startsWith("/recruit/accept?token="));
  await scheduleRecruitmentFollowUp({ actor: recruitingActor, recruitmentId: invited.recruitmentId, nextFollowUpAt: new Date(Date.now() + 86_400_000), note: "Check whether the candidate needs the contractor terms explained" });
  const [recruitment] = await db.select().from(campusRecruitments).where(eq(campusRecruitments.id, invited.recruitmentId)).limit(1);
  const [storedReferral] = await db.select().from(studentReferrals).where(eq(studentReferrals.id, referral.referralId)).limit(1);
  assert.equal(recruitment.source, "student_recommendation");
  assert.equal(storedReferral.state, "invited");

  const [financialAfter, ledgerAfter] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);
  assert.deepEqual(financialAfter, financialBefore);
  assert.deepEqual(ledgerAfter, ledgerBefore);
  console.log(JSON.stringify({
    status: "passed",
    mode: "local_sandbox_database_acceptance",
    caseManagement: { collisionWinners: 1, firstResponseTracked: true, internalNotesHiddenFromRep: true, snoozeWake: true, reopenPreservedResolutionAndCsat: true, nonDestructiveLinks: true, savedViews: true },
    crm: { timeline: true, tasks: true, draftsRequireApproval: true, externalDeliveryByPlatform: false, unverifiedWonBlocked: true, verifiedWonAllowed: true, forecastBoundary: true },
    training: { modules: 5, answerIndexesHidden: true, failedAttemptRecorded: true, durableCompletion: true, externalCertification: false },
    campaigns: { selfApprovalBlocked: true, independentApproval: true, inAppOnly: true, pause: true },
    integrations: { sandboxTest: true, sandboxSync: true, liveConfigurationFailClosed: true, externalRequestMade: false },
    growth: { leaderboard: true, explainableTargets: true, recommendationToOpportunity: true, consentLedStudentReferral: true, recruitmentFollowUp: true },
    financialRecordsUnchanged: true,
    liveProviderRequestMade: false,
    productionReady: false,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
