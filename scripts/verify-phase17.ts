import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  attributionRecords,
  caseAttachments,
  caseChannelIntakes,
  caseExperienceSurveys,
  caseMessages,
  caseRoutingRules,
  campuses,
  campusLeadAssignments,
  crmRoutingRules,
  crmSequenceSteps,
  deals,
  escrowWallets,
  knowledgeArticles,
  ledgerEntries,
  opportunities,
  payouts,
  products,
  reps,
  universalConsents,
  users,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { salesActorForUser } from "../api/services/salesAccess";
import { storage } from "../api/lib/storage";
import { createOpportunity } from "../api/services/crm";
import { addCaseMessage } from "../api/services/caseManagement";
import { resolveSupportTicket } from "../api/services/support";
import {
  acknowledgeCoaching,
  addCapabilityEvidence,
  assessRiskTiming,
  createControlDefinition,
  createMetricDefinition,
  createPortabilityManifest,
  createPurposePolicy,
  decideRiskTiming,
  generateBenchmark,
  generateCoaching,
  linkActivationEvidence,
  listPlatformInnovationWorkspace,
  publishControlDefinition,
  publishMetricDefinition,
  publishPurposePolicy,
  reconcileIndependentOutcome,
  recordActivationEvidence,
  recordIndependentOutcome,
  recordUniversalConsent,
  registerProviderProfile,
  requirePurpose,
  runControlSimulation,
  runPromotionSimulation,
  runResilienceDrill,
  snapshotMetric,
} from "../api/services/platformInnovations";
import {
  addCrmCollaborationNote,
  addCrmInfluence,
  advanceCrmSequence,
  applyCrmRouting,
  applyCrmScorecard,
  approveCrmSequence,
  createCrmForecast,
  createCrmRoutingRule,
  createCrmScorecard,
  createCrmSequence,
  detectCrmDuplicates,
  generateCrmRecommendation,
  listCrmInnovationWorkspace,
  proposeCrmRouting,
  recordCrmFeedback,
  resolveCrmDuplicate,
  reviewCrmRecommendation,
} from "../api/services/crmInnovations";
import {
  acceptCaseCopilot,
  applyCaseRouting,
  applyCaseSlaPolicy,
  approveKnowledgeArticle,
  caseAttachmentUrl,
  createCaseRoutingRule,
  createCaseSlaPolicy,
  createKnowledgeArticle,
  createMajorIncident,
  createProblemRecord,
  deleteCaseAttachment,
  intakeCaseChannel,
  linkCaseKnowledge,
  linkProblemCase,
  listCaseInnovationWorkspace,
  proposeCaseRouting,
  recordCaseExperience,
  reviewCaseQuality,
  runCaseCopilot,
  setCaseAgentSkill,
  setCaseWaiting,
  suggestCaseKnowledge,
  updateMajorIncident,
  updateProblemRecord,
  uploadCaseAttachment,
} from "../api/services/caseInnovations";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
let phoneCounter = 0;
const uniquePhone = () => `+23497${String(Date.now() + phoneCounter++).slice(-8)}`;
const uniqueKey = (label: string) => `p17-${label}-${suffix.slice(0, 10)}`;
const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function financialSnapshot() {
  const [dealRows, attributionRows, ledgerRows, escrowRows, payoutRows] = await Promise.all([
    db.select().from(deals).orderBy(asc(deals.id)),
    db.select().from(attributionRecords).orderBy(asc(attributionRecords.id)),
    db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.id)),
    db.select().from(escrowWallets).orderBy(asc(escrowWallets.vendorId)),
    db.select().from(payouts).orderBy(asc(payouts.id)),
  ]);
  return { dealRows, attributionRows, ledgerRows, escrowRows, payoutRows };
}

async function makeOperationsUser(label: string) {
  const [user] = await db.insert(users).values({
    phoneE164: uniquePhone(),
    name: `Phase 17 ${label} ${suffix.slice(0, 5)}`,
    role: "ops",
  }).returning();
  return { user, actor: await salesActorForUser(user) };
}

async function main() {
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  assert.ok(product, "Seeded savings product is required");
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, product.vendorId)).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor.userId!)).limit(1);
  const [team] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [lead] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [teamUser] = await db.select().from(users).where(eq(users.id, team.userId)).limit(1);
  const [leadUser] = await db.select().from(users).where(eq(users.id, lead.userId)).limit(1);
  const [deal] = await db.select().from(deals).orderBy(desc(deals.id)).limit(1);
  const [otherCampus] = await db.select().from(campuses).where(eq(campuses.id, team.campusId)).limit(1);
  assert.ok(vendor && vendorUser && team && lead && teamUser && leadUser && deal && otherCampus);
  await db.update(reps).set({ tier: "campus_lead", status: "active" }).where(eq(reps.id, lead.id));
  await db.update(reps).set({ status: "active" }).where(eq(reps.id, team.id));
  await db.update(campusLeadAssignments).set({ leadRepId: lead.id, campusId: team.campusId, revokedAt: null }).where(eq(campusLeadAssignments.repId, team.id));

  const { user: opsUser, actor: ops } = await makeOperationsUser("Operator");
  const { user: reviewerUser, actor: reviewer } = await makeOperationsUser("Independent Reviewer");
  const vendorActor = await salesActorForUser(vendorUser);
  const teamActor = await salesActorForUser(teamUser);
  const leadActor = await salesActorForUser(leadUser);
  const [outsiderUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 17 Outsider ${suffix.slice(0, 4)}`, role: "rep" }).returning();
  const [outsiderRep] = await db.insert(reps).values({ userId: outsiderUser.id, campusId: otherCampus.id, code: uniqueKey("outsider").slice(0, 32), status: "active" }).returning();
  const outsider = await salesActorForUser(outsiderUser);
  assert.equal(outsider.repId, outsiderRep.id);
  const before = await financialSnapshot();

  // 1. Activation Evidence Graph: hash-only evidence, lineage, and cycle rejection.
  const rawEvidence = `sensitive-evidence-${suffix}`;
  const firstEvidence = await recordActivationEvidence({ actor: ops, dealId: deal.id, kind: "vendor_confirmation", source: uniqueKey("source"), evidence: rawEvidence, observedAt: new Date() });
  const secondEvidence = await recordActivationEvidence({ actor: ops, dealId: deal.id, kind: "independent_review", source: uniqueKey("review"), evidence: `derived-${rawEvidence}`, observedAt: new Date() });
  const lineage = await linkActivationEvidence({ actor: ops, fromNodeId: secondEvidence.nodeId, toNodeId: firstEvidence.nodeId, relationship: "derived_from", rationale: "Independent observation derives from the vendor-confirmed activation." });
  assert.equal(lineage.linked, true);
  await assert.rejects(() => linkActivationEvidence({ actor: ops, fromNodeId: firstEvidence.nodeId, toNodeId: secondEvidence.nodeId, relationship: "cycle", rationale: "A cycle must be rejected." }), /cycle/);
  const evidenceWorkspace = await listPlatformInnovationWorkspace(ops);
  assert.ok(!JSON.stringify(evidenceWorkspace.nodes).includes(rawEvidence));

  // 2. Promotion Digital Twin: bounded assumptions, no commercial mutation.
  const twin = await runPromotionSimulation({ actor: vendorActor, name: uniqueKey("twin"), representatives: 10, activationsPerRepresentative: 4, vendorCommissionKobo: 100_000, budgetCapKobo: 1_000_000, escrowKobo: 750_000, refundPct: 10 });
  assert.equal(twin.resultsJson.projectedGrossActivations, 40);
  assert.equal(twin.resultsJson.fundedActivations, 7);
  assert.equal(twin.resultsJson.liveStateChanged, false);
  assert.equal(twin.resultsJson.commissionEntitlementCreated, false);

  // 3. Versioned Metrics: independent publication and reproducible snapshots.
  const metric = await createMetricDefinition({ actor: ops, metricKey: "verified_activation_count", name: uniqueKey("metric"), formula: "count(confirmed + payable + paid)", sourceContract: "deals.created_at and financial state" });
  await assert.rejects(() => publishMetricDefinition({ actor: ops, definitionId: metric.id }), /Independent/);
  await publishMetricDefinition({ actor: reviewer, definitionId: metric.id });
  const metricSnapshot = await snapshotMetric({ actor: ops, definitionId: metric.id, scopeType: "global", scopeId: 0, periodStart: past(60 * 24 * 30), periodEnd: new Date() });
  assert.equal(metricSnapshot.valueDenominator, 1);
  assert.equal(metricSnapshot.sourceHash.length, 64);

  // 4. Universal Consent: active notices, hashed subjects, allow/deny events and revocation.
  const outreachPolicy = await createPurposePolicy({ actor: ops, purpose: "relationship_outreach", notice: "Human-approved relationship outreach only; no live external delivery.", retentionDays: 30 });
  await assert.rejects(() => publishPurposePolicy({ actor: ops, policyId: outreachPolicy.id }), /Independent/);
  await publishPurposePolicy({ actor: reviewer, policyId: outreachPolicy.id });
  const feedbackPolicy = await createPurposePolicy({ actor: ops, purpose: "service_feedback", notice: "Voluntary service feedback with redacted comments.", retentionDays: 30 });
  await publishPurposePolicy({ actor: reviewer, policyId: feedbackPolicy.id });
  const outreachSubject = `outreach-subject-${suffix}`;
  const outreachConsent = await recordUniversalConsent({ actor: ops, subjectToken: outreachSubject, purpose: "relationship_outreach", state: "granted", evidenceRef: uniqueKey("consent") });
  const allowedPurpose = await requirePurpose({ actor: ops, subjectTokenHash: outreachConsent.subjectTokenHash, purpose: "relationship_outreach", action: "acceptance.initial" });
  assert.equal(allowedPurpose.allowed, true);
  assert.ok(!JSON.stringify(await db.select().from(universalConsents).where(eq(universalConsents.id, outreachConsent.consentId))).includes(outreachSubject));

  // 5. Composable Controls: independently published, explainable simulation only.
  const control = await createControlDefinition({ actor: ops, controlKey: uniqueKey("control"), name: "Evidence mismatch review", triggerEvent: "outcome.reconciled", conditions: [{ field: "risk.score", operator: "gte", value: 25 }], action: "open_review" });
  await assert.rejects(() => publishControlDefinition({ actor: ops, controlId: control.id }), /Independent/);
  await publishControlDefinition({ actor: reviewer, controlId: control.id });
  const controlRun = await runControlSimulation({ actor: ops, controlId: control.id, inputJson: { risk: { score: 30 } } });
  assert.equal(controlRun.matched, true);
  assert.equal(controlRun.decision, "open_review");
  assert.equal(controlRun.mode, "simulation");

  // 6. Independent Vendor Outcome Network: reconciliation does not rewrite deal state.
  const outcome = await recordIndependentOutcome({ actor: ops, dealId: deal.id, observer: "independent_acceptance_observer", outcome: "amount_mismatch", evidence: `outcome-evidence-${suffix}`, observedAt: new Date() });
  assert.ok(outcome.observationId);
  const reconciled = await reconcileIndependentOutcome({ actor: ops, observationId: outcome.observationId!, state: "mismatch", reason: "Synthetic mismatch retained for independent review." });
  assert.equal(reconciled.financialStateChanged, false);

  // 7. Capability Graph and Coaching: team-scoped assessment and owner acknowledgement.
  await addCapabilityEvidence({ actor: leadActor, repId: team.id, capability: "privacy", level: 55, evidenceType: "training_assessment", evidenceRef: uniqueKey("capability") });
  await assert.rejects(() => addCapabilityEvidence({ actor: outsider, repId: team.id, capability: "privacy", level: 10, evidenceType: "invalid", evidenceRef: "invalid" }), /Campus Lead|Operations/);
  const coaching = await generateCoaching({ actor: leadActor, repId: team.id });
  await assert.rejects(() => acknowledgeCoaching({ actor: outsider, recommendationId: coaching.id }), /owner/);
  await acknowledgeCoaching({ actor: teamActor, recommendationId: coaching.id });

  // 8. Privacy-Preserving Benchmarks: small cells are fully suppressed.
  const benchmark = await generateBenchmark({ actor: ops, scopeType: "vendor", periodStart: past(60 * 24 * 30), periodEnd: new Date(), minimumCohort: 5 });
  assert.ok(benchmark.cellsJson.every((cell) => cell.cohort >= 5 || (cell.suppressed && cell.cohort === 0 && cell.numerator === 0 && cell.denominator === 0)));

  // 9. Risk-Adaptive Timing: recommendation and human decision, never automatic payout action.
  const risk = await assessRiskTiming({ actor: ops, dealId: deal.id });
  assert.equal(risk.automaticFinancialAction, false);
  const riskDecision = await decideRiskTiming({ actor: reviewer, assessmentId: risk.id, state: "accepted", reason: "Review recommendation accepted without changing the payout schedule." });
  assert.equal(riskDecision.payoutScheduleChanged, false);

  // 10. Resilience and Portability: hashed configuration and simulated recovery evidence.
  await assert.rejects(() => registerProviderProfile({ actor: ops, providerKey: uniqueKey("bad-provider"), capability: "storage", portabilityTier: "portable", configuration: { apiKey: "must-not-be-persisted" } }), /never credentials/);
  const provider = await registerProviderProfile({ actor: ops, providerKey: uniqueKey("provider"), capability: "object_storage", portabilityTier: "portable", configuration: { region: "sandbox", contractVersion: 1 } });
  const drill = await runResilienceDrill({ actor: ops, providerId: provider.id, scenario: "provider_failover" });
  assert.equal(drill.mode, "simulation");
  const manifest = await createPortabilityManifest({ actor: ops, providerId: provider.id });
  assert.equal(manifest.verificationState, "verified_hash_only");

  const customerPhone = uniquePhone();
  const firstOpportunity = await createOpportunity({ actor: teamActor, repId: team.id, productId: product.id, alias: `Phase 17 primary ${suffix.slice(0, 4)}`, customerPhone, nextActionAt: new Date(Date.now() + 86_400_000), source: "phase17_acceptance" });
  const secondOpportunity = await createOpportunity({ actor: leadActor, repId: lead.id, productId: product.id, alias: `Phase 17 duplicate ${suffix.slice(0, 4)}`, customerPhone, source: "phase17_acceptance" });
  assert.equal(firstOpportunity.financialDealCreated, false);

  // CRM 1–2: Relationship 360 evidence and explainable next best action.
  const recommendation = await generateCrmRecommendation({ actor: teamActor, opportunityId: firstOpportunity.opportunityId });
  assert.ok(recommendation.reasonsJson.length > 0);
  await reviewCrmRecommendation({ actor: teamActor, recommendationId: recommendation.id, state: "accepted", feedback: "Owner accepted the explainable relationship action." });
  const relationshipWorkspace = await listCrmInnovationWorkspace(teamActor);
  assert.ok(relationshipWorkspace.opportunities.some((row) => row.opportunity.id === firstOpportunity.opportunityId));
  assert.ok(relationshipWorkspace.activities.some((row) => row.opportunityId === firstOpportunity.opportunityId));

  // CRM 3: Versioned signal scoring is stable when repeated without new evidence.
  const scorecard = await createCrmScorecard({ actor: ops, scorecardKey: uniqueKey("scorecard"), weights: { productFit: 20, stage: 20, attribution: 20, activity: 20, nextAction: 20 }, rationale: "Equal-weight acceptance scorecard using stable evidence signals." });
  const firstScore = await applyCrmScorecard({ actor: teamActor, scorecardId: scorecard.id, opportunityId: firstOpportunity.opportunityId, expectedVersion: 1 });
  const secondScore = await applyCrmScorecard({ actor: teamActor, scorecardId: scorecard.id, opportunityId: firstOpportunity.opportunityId, expectedVersion: 2 });
  assert.equal(secondScore.score, firstScore.score);

  // CRM 4: Scenario forecasts are planning artifacts, not earned commission.
  for (const scenario of ["commit", "best", "pipeline"] as const) {
    const forecast = await createCrmForecast({ actor: teamActor, name: uniqueKey(`forecast-${scenario}`), scenario });
    assert.equal(forecast.earnedCommission, false);
    assert.equal(forecast.financialDealCreated, false);
  }

  // CRM 5: Human-approved sequences check current consent before every sandbox step.
  const sequence = await createCrmSequence({ actor: teamActor, opportunityId: firstOpportunity.opportunityId, name: uniqueKey("sequence"), purpose: "relationship_outreach", subjectToken: outreachSubject, steps: [
    { channel: "in_app", body: "Review the relationship context internally.", dueAt: past(10) },
    { channel: "email", body: "Sandbox-only follow-up receipt.", dueAt: past(5) },
  ] });
  await assert.rejects(() => approveCrmSequence({ actor: teamActor, sequenceId: sequence.sequenceId }), /second human/);
  await approveCrmSequence({ actor: ops, sequenceId: sequence.sequenceId });
  const advanced = await advanceCrmSequence({ actor: teamActor, sequenceId: sequence.sequenceId });
  assert.equal(advanced.externalRequestMade, false);
  await recordUniversalConsent({ actor: ops, subjectToken: outreachSubject, purpose: "relationship_outreach", state: "revoked", evidenceRef: uniqueKey("revocation") });
  await assert.rejects(() => advanceCrmSequence({ actor: teamActor, sequenceId: sequence.sequenceId }), /revoked/);
  const pendingSteps = await db.select().from(crmSequenceSteps).where(and(eq(crmSequenceSteps.sequenceId, sequence.sequenceId), eq(crmSequenceSteps.stepNumber, 2))).limit(1);
  assert.equal(pendingSteps[0].state, "pending");

  // CRM 6–7: Collaboration mentions and non-destructive duplicate review.
  await addCrmCollaborationNote({ actor: teamActor, opportunityId: firstOpportunity.opportunityId, body: "Operations mentioned for a relationship review; no financial action requested.", visibility: "team", mentionedUserIds: [opsUser.id] });
  const duplicates = await detectCrmDuplicates({ actor: ops, opportunityId: firstOpportunity.opportunityId });
  assert.ok(duplicates.reviews.some((row) => row.matchedOpportunityId === secondOpportunity.opportunityId || row.opportunityId === secondOpportunity.opportunityId));
  assert.equal(duplicates.automaticMerge, false);
  const duplicateResolution = await resolveCrmDuplicate({ actor: ops, reviewId: duplicates.reviews[0].id, state: "not_duplicate", reason: "Distinct relationship owners retained; no merge or deletion." });
  assert.equal(duplicateResolution.recordsDeleted, false);
  assert.equal(duplicateResolution.financialAttributionChanged, false);

  // CRM 8: Influence evidence does not create attribution or entitlement.
  const influence = await addCrmInfluence({ actor: teamActor, opportunityId: firstOpportunity.opportunityId, touchType: "educational_event", occurredAt: past(60), evidenceRef: uniqueKey("influence") });
  assert.equal(influence.firstTouchAttributionChanged, false);
  assert.equal(influence.commissionEntitlementCreated, false);

  // CRM 10: Consent-led voice-of-customer feedback with redacted subject persistence.
  const feedbackSubject = `feedback-subject-${suffix}`;
  await recordUniversalConsent({ actor: ops, subjectToken: feedbackSubject, purpose: "service_feedback", state: "granted", evidenceRef: uniqueKey("feedback-consent") });
  const feedback = await recordCrmFeedback({ actor: teamActor, opportunityId: firstOpportunity.opportunityId, subjectToken: feedbackSubject, category: "relationship", rating: 5, comment: "Clear next step and respectful communication.", source: "sandbox_acceptance" });
  assert.equal(feedback.rawSubjectPersisted, false);
  await recordUniversalConsent({ actor: ops, subjectToken: feedbackSubject, purpose: "service_feedback", state: "revoked", evidenceRef: uniqueKey("feedback-revoked") });
  await assert.rejects(() => recordCrmFeedback({ actor: teamActor, opportunityId: firstOpportunity.opportunityId, subjectToken: feedbackSubject, category: "relationship", rating: 4, comment: "Must be blocked after revocation.", source: "sandbox_acceptance" }), /revoked/);

  // CRM 9: Capacity routing changes relationship ownership only, never first-touch finance.
  const [priorCrmRule] = await db.select().from(crmRoutingRules).orderBy(asc(crmRoutingRules.priority)).limit(1);
  const crmRule = await createCrmRoutingRule({ actor: ops, name: uniqueKey("crm-route"), campusId: team.campusId, productId: product.id, maxOpenOpportunities: 1000, priority: (priorCrmRule?.priority ?? 1) - 1 });
  const crmProposal = await proposeCrmRouting({ actor: ops, opportunityId: firstOpportunity.opportunityId });
  assert.equal(crmProposal.ruleId, crmRule.id);
  assert.ok(crmProposal.proposedRepId);
  const [opportunityBeforeRouting] = await db.select().from(opportunities).where(eq(opportunities.id, firstOpportunity.opportunityId)).limit(1);
  const routed = await applyCrmRouting({ actor: ops, decisionId: crmProposal.id, expectedVersion: opportunityBeforeRouting.version });
  assert.equal(routed.financialAttributionChanged, false);

  // Case 1: Sandbox omnichannel intake is idempotent and role-scoped.
  const intakeInput = { channel: "email" as const, externalId: uniqueKey("external-message"), repId: team.id, vendorId: vendor.id, customerPhone, category: "activation", subject: `Phase 17 activation review ${suffix.slice(0, 4)}`, description: "Synthetic activation evidence question for sandbox acceptance." };
  const intake = await intakeCaseChannel({ actor: ops, ...intakeInput });
  const duplicateIntake = await intakeCaseChannel({ actor: ops, ...intakeInput });
  assert.equal(duplicateIntake.ticketId, intake.ticketId);
  assert.equal(duplicateIntake.state, "duplicate");
  assert.equal(intake.externalRequestMade, false);
  const intakeRows = await db.select().from(caseChannelIntakes).where(eq(caseChannelIntakes.id, intake.intakeId)).limit(1);
  assert.ok(!JSON.stringify(intakeRows).includes(intakeInput.externalId));
  await assert.rejects(() => runCaseCopilot({ actor: outsider, ticketId: intake.ticketId }), /Case not found/);

  // Case 2: Assessed skills and workload determine routing; assignment stays non-financial.
  await setCaseAgentSkill({ actor: ops, userId: reviewerUser.id, skill: "activation_review", level: 95, active: true });
  const [priorCaseRule] = await db.select().from(caseRoutingRules).orderBy(asc(caseRoutingRules.priority)).limit(1);
  const caseRule = await createCaseRoutingRule({ actor: ops, name: uniqueKey("case-route"), category: "activation", vendorId: vendor.id, skill: "activation_review", maxOpenCases: 1000, priority: (priorCaseRule?.priority ?? 1) - 1 });
  const caseProposal = await proposeCaseRouting({ actor: ops, ticketId: intake.ticketId });
  assert.equal(caseProposal.ruleId, caseRule.id);
  assert.equal(caseProposal.proposedUserId, reviewerUser.id);
  const appliedCaseRoute = await applyCaseRouting({ actor: ops, decisionId: caseProposal.id, expectedVersion: 1 });
  assert.equal(appliedCaseRoute.assigneeUserId, reviewerUser.id);

  // Case 3: Africa/Lagos business-hours policies and waiting-time adjustments.
  await assert.rejects(() => createCaseSlaPolicy({ actor: ops, name: "Invalid SLA", priority: "normal", firstResponseMinutes: 120, resolutionMinutes: 60, businessStartMinute: 480, businessEndMinute: 1020, businessDays: [1, 2, 3, 4, 5] }), /at least/);
  const sla = await createCaseSlaPolicy({ actor: ops, name: uniqueKey("sla"), priority: "normal", firstResponseMinutes: 60, resolutionMinutes: 480, businessStartMinute: 480, businessEndMinute: 1020, businessDays: [1, 2, 3, 4, 5] });
  const withSla = await applyCaseSlaPolicy({ actor: ops, ticketId: intake.ticketId, policyId: sla.id, expectedVersion: 2 });
  assert.ok(withSla.firstResponseDueAt && withSla.slaDueAt > withSla.firstResponseDueAt);
  await setCaseWaiting({ actor: ops, ticketId: intake.ticketId, waiting: true, reason: "Waiting for synthetic vendor evidence." });
  const stoppedWaiting = await setCaseWaiting({ actor: ops, ticketId: intake.ticketId, waiting: false, reason: "Synthetic evidence received." });
  assert.equal(stoppedWaiting.waiting, false);

  // Case 4: Reviewed object-storage attachments with independent reads and browser content proof.
  const attachmentText = `Phase 17 harmless attachment ${suffix}\nSandbox evidence only; no live provider or financial claim.`;
  let attachmentId: number | null = null;
  let attachmentDeleted = false;
  try {
    await assert.rejects(() => uploadCaseAttachment({ actor: teamActor, ticketId: intake.ticketId, fileName: "internal.txt", contentBase64: Buffer.from("not allowed").toString("base64"), contentType: "text/plain", visibility: "internal" }), /cannot upload/);
    await assert.rejects(() => uploadCaseAttachment({ actor: ops, ticketId: intake.ticketId, fileName: "bad.txt", contentBase64: "not base64!", contentType: "text/plain", visibility: "internal" }), /canonical base64/);
    const uploaded = await uploadCaseAttachment({ actor: ops, ticketId: intake.ticketId, fileName: `phase17-${suffix.slice(0, 6)}.txt`, contentBase64: Buffer.from(attachmentText).toString("base64"), contentType: "text/plain", visibility: "internal" });
    attachmentId = uploaded.attachmentId;
    const [storedAttachment] = await db.select().from(caseAttachments).where(eq(caseAttachments.id, attachmentId)).limit(1);
    assert.equal(storedAttachment.reviewStatus, "active");
    assert.ok(!JSON.stringify(storedAttachment).includes("http"));
    assert.equal(await storage.fileExists({ fileKey: storedAttachment.objectKey }), true);
    const head = await storage.headFile({ fileKey: storedAttachment.objectKey });
    assert.equal(head.size, Buffer.byteLength(attachmentText));
    const listed = await storage.listFiles({ prefix: `cases/${intake.ticketId}/`, delimiter: "", maxKeys: 100 });
    assert.ok(listed.objects.some((object) => object.key === storedAttachment.objectKey));
    await assert.rejects(() => caseAttachmentUrl({ actor: teamActor, attachmentId }), /Attachment not found/);
    const temporaryUrl = await caseAttachmentUrl({ actor: ops, attachmentId });
    const metadataPath = `/tmp/kampusforce-phase17-storage-${suffix}.json`;
    const resultPath = `/tmp/kampusforce-phase17-storage-${suffix}.result.json`;
    writeFileSync(metadataPath, JSON.stringify({ url: temporaryUrl.url, expectedText: attachmentText }));
    try {
      let browserStdout = "";
      let browserStderr = "";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const browser = spawnSync("python3", ["scripts/verify-phase17-storage-browser.py", metadataPath], { cwd: process.cwd(), encoding: "utf-8", timeout: 120_000 });
        browserStdout = browser.stdout;
        browserStderr = browser.stderr;
        if (browser.status === 0) break;
        if (attempt === 1) throw new Error(`Attachment browser verification failed: ${browserStderr || browserStdout}`);
      }
      assert.ok(browserStdout.includes("storageBrowserContentMatched"));
    } finally {
      rmSync(metadataPath, { force: true });
      rmSync(resultPath, { force: true });
    }
    const deleted = await deleteCaseAttachment({ actor: ops, attachmentId });
    attachmentDeleted = true;
    assert.equal(deleted.deleted, true);
    assert.equal(await storage.fileExists({ fileKey: storedAttachment.objectKey }), false);
  } finally {
    if (attachmentId && !attachmentDeleted) await deleteCaseAttachment({ actor: ops, attachmentId }).catch(() => undefined);
  }

  // Case 5: Approved knowledge center and case-specific suggestions.
  const article = await createKnowledgeArticle({ actor: ops, articleKey: uniqueKey("knowledge"), title: "Review activation evidence", category: "activation", body: "Compare vendor evidence. Contact test@example.com or +2348012345678 only in a synthetic example.", keywords: ["activation", "vendor"] });
  assert.ok(article.redactions.length >= 1);
  await assert.rejects(() => approveKnowledgeArticle({ actor: ops, articleId: article.id }), /Independent/);
  await approveKnowledgeArticle({ actor: reviewer, articleId: article.id });
  const suggestions = await suggestCaseKnowledge({ actor: ops, ticketId: intake.ticketId });
  assert.ok(suggestions.some((suggestion) => suggestion.article.id === article.id));
  await linkCaseKnowledge({ actor: ops, ticketId: intake.ticketId, articleId: article.id, helpful: true });
  const [storedArticle] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, article.id)).limit(1);
  assert.ok(!storedArticle.body.includes("test@example.com"));

  // Case 6–7: Problem/known-error records and internal major-incident command.
  const problem = await createProblemRecord({ actor: ops, title: uniqueKey("problem"), ownerUserId: opsUser.id });
  const linkedProblem = await linkProblemCase({ actor: ops, problemId: problem.id, ticketId: intake.ticketId });
  assert.equal(linkedProblem.destructiveMerge, false);
  await updateProblemRecord({ actor: ops, problemId: problem.id, state: "known_error", rootCause: "Synthetic delayed evidence adapter.", workaround: "Use reviewed manual evidence reconciliation." });
  await updateProblemRecord({ actor: ops, problemId: problem.id, state: "resolved", rootCause: "Synthetic delayed evidence adapter.", workaround: "Use reviewed manual evidence reconciliation." });
  const incident = await createMajorIncident({ actor: ops, title: uniqueKey("incident"), severity: "sev2", commanderUserId: opsUser.id, problemId: problem.id });
  await assert.rejects(() => updateMajorIncident({ actor: ops, incidentId: incident.id, state: "monitoring", body: "Public update must use a separately approved channel.", visibility: "public" }), /internal incident updates/);
  const resolvedIncident = await updateMajorIncident({ actor: ops, incidentId: incident.id, state: "resolved", body: "Synthetic incident resolved; no external communication sent.", visibility: "internal" });
  assert.equal(resolvedIncident.externalCommunicationSent, false);

  // Case 8: Independent quality review and coaching; self-review is forbidden.
  await assert.rejects(() => reviewCaseQuality({ actor: reviewer, ticketId: intake.ticketId, scores: { ownership: 20, evidence: 20, communication: 20, privacy: 20, resolution: 20 }, coachingNote: "Self review must fail." }), /own assigned case/);
  const quality = await reviewCaseQuality({ actor: ops, ticketId: intake.ticketId, scores: { ownership: 20, evidence: 18, communication: 19, privacy: 20, resolution: 18 }, coachingNote: "Retain independent outcome evidence before closure." });
  assert.equal(quality.totalScore, 95);

  // Case 10: Redacting copilot is human-accepted decision support with staff-message isolation.
  const internalMarker = `INTERNAL-ONLY-${suffix}`;
  await addCaseMessage({ actor: ops, ticketId: intake.ticketId, visibility: "internal", body: `${internalMarker}; call +2348012345678 or email staff@example.com.` });
  await addCaseMessage({ actor: ops, ticketId: intake.ticketId, visibility: "public", body: "Public synthetic status: evidence review is underway." });
  const staffCopilot = await runCaseCopilot({ actor: ops, ticketId: intake.ticketId });
  assert.ok(staffCopilot.redactionsJson.length > 0);
  assert.ok(!staffCopilot.summary.includes("+2348012345678"));
  assert.equal(staffCopilot.autonomousReplySent, false);
  await acceptCaseCopilot({ actor: ops, runId: staffCopilot.id });
  const repCopilot = await runCaseCopilot({ actor: teamActor, ticketId: intake.ticketId });
  assert.ok(!repCopilot.summary.includes(internalMarker));
  const repCaseWorkspace = await listCaseInnovationWorkspace(teamActor);
  assert.ok(repCaseWorkspace.copilot.every((run) => run.createdByUserId === teamActor.userId));
  assert.ok(repCaseWorkspace.cases.flatMap((row) => row.ticket.id === intake.ticketId ? [row] : []).length === 1);
  const allMessages = await db.select().from(caseMessages).where(eq(caseMessages.ticketId, intake.ticketId));
  assert.ok(allMessages.some((message) => message.visibility === "internal"));
  const opsCaseWorkspace = await listCaseInnovationWorkspace(ops);
  assert.ok(opsCaseWorkspace.attachments.every((attachment) => !("objectKey" in attachment)));
  const vendorCaseWorkspace = await listCaseInnovationWorkspace(vendorActor);
  assert.ok(vendorCaseWorkspace.macros.every((macro) => macro.vendorId === vendor.id));

  // Case 9: Post-resolution CSAT and customer-effort analytics with idempotent surveys.
  await resolveSupportTicket({ ticketId: intake.ticketId, actorUserId: opsUser.id, actor: "ops", resolution: "Synthetic evidence reconciled and the case resolved without financial mutation." });
  const respondent = `respondent-${suffix}`;
  const survey = await recordCaseExperience({ actor: ops, ticketId: intake.ticketId, respondentToken: respondent, csat: 5, effort: 2, comment: "Clear resolution; contact example@example.com in this synthetic comment." });
  assert.equal(survey.rawRespondentPersisted, false);
  assert.ok(survey.redactions.includes("email:1"));
  const duplicateSurvey = await recordCaseExperience({ actor: ops, ticketId: intake.ticketId, respondentToken: respondent, csat: 5, effort: 2 });
  assert.equal(duplicateSurvey.duplicate, true);
  const [storedSurvey] = await db.select().from(caseExperienceSurveys).where(eq(caseExperienceSurveys.id, survey.surveyId!)).limit(1);
  assert.ok(!JSON.stringify(storedSurvey).includes(respondent));
  const finalCaseWorkspace = await listCaseInnovationWorkspace(ops);
  assert.equal(finalCaseWorkspace.metrics.averageCsat !== null, true);
  assert.equal(finalCaseWorkspace.features.length, 10);

  const finalPlatformWorkspace = await listPlatformInnovationWorkspace(ops);
  const finalCrmWorkspace = await listCrmInnovationWorkspace(ops);
  assert.equal(finalPlatformWorkspace.features.length, 10);
  assert.equal(finalCrmWorkspace.features.length, 10);
  assert.deepEqual(await financialSnapshot(), before, "Innovation workflows must not mutate deals, attribution, ledger, escrow or payouts");

  console.log(JSON.stringify({
    phase: 17,
    status: "passed",
    platformInnovations: 10,
    crmInnovations: 10,
    caseInnovations: 10,
    independentApprovals: true,
    consentRevocationEnforced: true,
    roleIsolation: true,
    nonDestructiveDuplicatesAndRouting: true,
    storageUploadReview: "active",
    storageIndependentReads: true,
    storageBrowserContentMatched: true,
    storageDeletedAndRechecked: true,
    staffEvidenceIsolation: true,
    financialPreservation: ["deals", "attribution", "ledger", "escrow", "payouts"],
    externalDelivery: "sandbox receipts only",
    autonomousReplies: false,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
