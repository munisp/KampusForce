import "dotenv/config";
import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import {
  applicants,
  attributionRecords,
  campuses,
  commissionRecurrenceReceipts,
  commissionRecurrenceSchedules,
  commissionRules,
  deals,
  escrowWallets,
  ledgerEntries,
  payouts,
  products,
  reps,
  talentApplicationDocuments,
  talentApplications,
  talentDocumentAnalyses,
  users,
  vendorConnectorProgressEvents,
  vendorExternalCustomerMappings,
  vendorOnboardingConnectors,
  vendorRepresentativeHandoffs,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { storage } from "../api/lib/storage";
import { webhookRoutes } from "../api/routes/webhooks";
import { salesActorForUser } from "../api/services/salesAccess";
import {
  addInstitutionalPartner,
  reviewInstitutionalGovernance,
  reviewInstitutionalPartner,
  submitInstitutionalGovernance,
  upsertInstitutionalGovernance,
} from "../api/services/institutionalCampaigns";
import {
  activateTalentCampaign,
  applyToTalentCampaign,
  createTalentCampaign,
  enforceTalentRetention,
  reviewTalentCampaign,
  submitTalentCampaign,
  withdrawTalentConsent,
  type ApplicantProfileInput,
} from "../api/services/talentCampaigns";
import {
  advanceTalentApplication,
  deleteTalentDocument,
  uploadTalentDocument,
  verifyTalentOutcome,
} from "../api/services/talentApplications";
import {
  analyzeTalentDocument,
  listTalentDocumentAnalysis,
  reviewTalentDocumentAnalysis,
  withdrawTalentDocumentAnalysis,
} from "../api/services/talentDocumentIntelligence";
import {
  activateVendorConnector,
  acceptRepresentativeHandoff,
  createRepresentativeHandoff,
  createVendorConnector,
  listVendorConnectorWorkspace,
  markRepresentativeHandoffProvisioned,
  recordConnectorProgress,
  reviewVendorConnector,
} from "../api/services/vendorConnectors";
import {
  changePromotionState,
  createPromotion,
  createPromotionLink,
  reviewPromotion,
  submitPromotionReview,
} from "../api/services/promotions";
import { ingestWithDurableRetry } from "../api/services/ingestionRetries";
import { confirmDueDeals } from "../api/services/ledger";
import { listRecurrenceWorkspace, runRecurrenceSweep } from "../api/services/recurrence";
import { hmacSha256, randomReference } from "../api/services/security";
import { rotateVendorWebhookCredential } from "../api/services/webhookCredentials";
import type { TalentCampaignType } from "../api/services/talentAccess";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const currentYear = new Date().getUTCFullYear();
let phoneCounter = 0;
const uniquePhone = () => `+23497${String(Date.now() + phoneCounter++).slice(-8)}`;
const uniqueKey = (label: string) => `p19-${label}-${suffix.slice(0, 10)}`;
const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const future = (days: number) => new Date(Date.now() + days * 86_400_000);

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
  const [user] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 19 ${label} ${suffix.slice(0, 5)}`, role: "ops" }).returning();
  return { user, actor: await salesActorForUser(user) };
}

async function currentApplication(applicationId: number) {
  const [application] = await db.select().from(talentApplications).where(eq(talentApplications.id, applicationId)).limit(1);
  assert.ok(application);
  return application;
}

function isAppendOnlyError(error: unknown) {
  const cause = (error as { cause?: Error }).cause;
  assert.match(cause?.message || "", /append-only/);
  return true;
}

function syntheticPdf(text: string) {
  const safeText = text.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 120);
  const stream = `BT /F1 12 Tf 72 720 Td (${safeText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

async function postConnectorProgress(vendorKey: string, secret: string, body: unknown, timestamp = Date.now(), signatureOverride?: string) {
  const raw = JSON.stringify(body);
  return webhookRoutes.request(`/${vendorKey}/connector-progress`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-KF-Timestamp": String(timestamp),
      "X-KF-Signature": signatureOverride || hmacSha256(raw, secret),
    },
    body: raw,
  });
}

async function main() {
  const [vendor] = await db.select().from(vendors).orderBy(asc(vendors.id)).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor?.userId ?? -1)).limit(1);
  const [team] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [teamUser] = await db.select().from(users).where(eq(users.id, team?.userId ?? -1)).limit(1);
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, team?.campusId ?? -1)).limit(1);
  const [financeUser] = await db.select().from(users).where(eq(users.role, "finance")).limit(1);
  assert.ok(vendor?.userId && vendorUser && team && teamUser && campus && financeUser);
  const { user: opsUser, actor: ops } = await makeOperationsUser("Operator");
  const { actor: reviewer } = await makeOperationsUser("Independent reviewer");
  const vendorActor = await salesActorForUser(vendorUser);
  const teamActor = await salesActorForUser(teamUser);
  const financeActor = await salesActorForUser(financeUser);
  const profile = (label: string, overrides: Partial<ApplicantProfileInput> = {}): ApplicantProfileInput => ({
    campusId: campus.id,
    fullName: `Synthetic Phase 19 ${label}`,
    email: `${uniqueKey(label)}@example.test`,
    course: "Mathematics",
    studyLevel: "Undergraduate",
    graduationYear: currentYear + 2,
    consentVersion: "phase19-consent-v1",
    consentedAt: past(10),
    retentionUntil: future(730),
    ...overrides,
  });

  async function createDraftCampaign(campaignType: TalentCampaignType, targetCount = 1) {
    const created = await createTalentCampaign({
      actor: ops,
      vendorId: vendor.id,
      title: `${uniqueKey(campaignType)} institutional control fixture`,
      campaignType,
      summary: "Synthetic sandbox programme with independently reviewed governance and non-financial outcomes.",
      targetCount,
      eligibleCourses: ["Mathematics"],
      startsAt: past(10),
      endsAt: future(90),
      targets: [{ campusId: campus.id, targetCount }],
    });
    return created.campaignId;
  }

  async function approveAndActivateCampaign(campaignId: number) {
    await submitTalentCampaign({ actor: ops, campaignId, expectedVersion: 1 });
    await assert.rejects(() => reviewTalentCampaign({ actor: ops, campaignId, decision: "approved", note: "Self review must not be accepted." }), /Independent review/);
    await reviewTalentCampaign({ actor: reviewer, campaignId, decision: "approved", note: "Independent campaign and non-financial outcome review completed." });
    await activateTalentCampaign({ actor: reviewer, campaignId });
  }

  const institutionalTypes: { type: TalentCampaignType; outcome: string }[] = [
    { type: "grant", outcome: "grant_awarded" },
    { type: "bursary", outcome: "bursary_awarded" },
    { type: "public_service", outcome: "service_placement" },
    { type: "volunteer", outcome: "volunteer_completion" },
    { type: "development_program", outcome: "development_completion" },
    { type: "public_health", outcome: "outreach_completion" },
    { type: "innovation_challenge", outcome: "challenge_completion" },
    { type: "emergency_response", outcome: "response_completion" },
    { type: "civic_program", outcome: "civic_completion" },
  ];

  const institutionalBefore = await financialSnapshot();
  for (const [index, item] of institutionalTypes.entries()) {
    const campaignId = await createDraftCampaign(item.type);
    await assert.rejects(() => submitTalentCampaign({ actor: ops, campaignId, expectedVersion: 1 }), /institutional governance/);
    const governance = await upsertInstitutionalGovernance({
      actor: ops,
      campaignId,
      governance: {
        sponsorType: index % 2 ? "international_organization" : "government",
        sponsorName: `Synthetic institutional sponsor ${index + 1}`,
        sponsorReference: `SPONSOR-${suffix.slice(0, 8)}-${index}`,
        fundingModel: index % 3 === 0 ? "procurement" : "grant",
        fundingReference: `FUNDING-${suffix.slice(0, 8)}-${index}`,
        fundingCurrency: "NGN",
        fundingAmountMinor: 10_000_000,
        procurementReference: index % 3 === 0 ? `PROCUREMENT-${suffix.slice(0, 8)}-${index}` : null,
        eligibilityPolicy: "Undergraduate students in the approved graduation cohort and course are eligible after institutional review.",
        eligibleStudyLevels: ["Undergraduate"],
        minimumGraduationYear: currentYear + 1,
        maximumGraduationYear: currentYear + 3,
        safeguardingPolicy: "Named safeguarding contacts, incident escalation and participant protection controls apply throughout delivery.",
        accessibilityPolicy: "Reasonable accommodation, accessible formats and alternative participation arrangements are reviewed before activation.",
        auditRequirements: "Institutional outcome evidence, reviewer identity and immutable audit records are retained under the approved schedule.",
      },
    });
    const partner = await addInstitutionalPartner({ actor: ops, campaignId, institutionName: `Synthetic partner ${index + 1}`, institutionType: index % 2 ? "international_organization" : "government", countryCode: "NG", partnerRole: "lead", governanceReference: `PARTNER-${suffix.slice(0, 8)}-${index}` });
    await assert.rejects(() => reviewInstitutionalPartner({ actor: ops, partnerId: partner.partnerId, decision: "approved", note: "Self approval must fail." }), /Independent partner review/);
    await assert.rejects(() => submitInstitutionalGovernance({ actor: ops, campaignId, expectedVersion: governance.version }), /independent approval/);
    await reviewInstitutionalPartner({ actor: reviewer, partnerId: partner.partnerId, decision: "approved", note: "Independent institutional partner evidence reviewed." });
    await submitInstitutionalGovernance({ actor: ops, campaignId, expectedVersion: governance.version });
    await assert.rejects(() => reviewInstitutionalGovernance({ actor: ops, campaignId, decision: "approved", note: "Self governance review must fail." }), /Independent institutional review/);
    await reviewInstitutionalGovernance({ actor: reviewer, campaignId, decision: "approved", note: "Funding, eligibility, safeguarding, accessibility and audit controls approved." });
    await approveAndActivateCampaign(campaignId);

    if (index === 0) {
      await assert.rejects(() => applyToTalentCampaign({ actor: teamActor, campaignId, profile: profile("wrong-study-level", { studyLevel: "Postgraduate" }) }), /study level/);
      await assert.rejects(() => applyToTalentCampaign({ actor: teamActor, campaignId, profile: profile("early-graduation", { graduationYear: currentYear }) }), /graduation year/);
      await assert.rejects(() => applyToTalentCampaign({ actor: teamActor, campaignId, profile: profile("late-graduation", { graduationYear: currentYear + 4 }) }), /graduation year/);
    }
    const application = await applyToTalentCampaign({ actor: teamActor, campaignId, profile: profile(item.type) });
    assert.equal(application.commissionCreated, false);
    await advanceTalentApplication({ actor: ops, applicationId: application.applicationId, expectedVersion: 1, toStage: "accepted", reason: "Institutional eligibility and selection evidence independently reviewed." });
    await assert.rejects(() => verifyTalentOutcome({ actor: ops, applicationId: application.applicationId, observedByUserId: opsUser.id, evidenceNote: "Self observation must fail.", observedAt: past(1) }), /independent/);
    const outcome = await verifyTalentOutcome({ actor: ops, applicationId: application.applicationId, observedByUserId: vendorUser.id, evidenceNote: "Synthetic independent programme outcome evidence; no customer activation or financial entitlement.", observedAt: past(1) });
    assert.equal(outcome.outcomeType, item.outcome);
    assert.equal(outcome.dealCreated, false);
    assert.equal(outcome.commissionCreated, false);
  }
  assert.deepEqual(await financialSnapshot(), institutionalBefore, "Institutional governance and outcomes must not change financial records");

  // Document intelligence is a separate consented operation with bounded persistence.
  const documentCampaignId = await createDraftCampaign("waitlist", 10);
  await approveAndActivateCampaign(documentCampaignId);
  const documentBefore = await financialSnapshot();
  const previousProcessorMode = process.env.KF_TALENT_PROCESSOR_MODE;
  let hashFailureVerified = false;
  let unconfiguredFailureVerified = false;
  let deletionVerified = false;
  let consentWithdrawalVerified = false;
  let retentionVerified = false;
  let storageDegradation: string | null = null;
  try {
    const first = await applyToTalentCampaign({ actor: teamActor, campaignId: documentCampaignId, profile: profile("document-review") });
    const sourceMarker = `SYNTHETIC-SOURCE-${suffix}`;
    const source = syntheticPdf(sourceMarker);
    const uploaded = await uploadTalentDocument({ actor: teamActor, applicationId: first.applicationId, documentType: "cv", fileName: `analysis-${suffix.slice(0, 6)}.pdf`, contentBase64: source.toString("base64"), contentType: "application/pdf" });
    const [storedDocument] = await db.select().from(talentApplicationDocuments).where(eq(talentApplicationDocuments.id, uploaded.documentId)).limit(1);
    assert.equal(await storage.fileExists({ fileKey: storedDocument.objectKey }), true);
    process.env.KF_TALENT_PROCESSOR_MODE = "fixture";
    await db.update(talentApplicationDocuments).set({ sha256: "0".repeat(64) }).where(eq(talentApplicationDocuments.id, uploaded.documentId));
    await assert.rejects(() => analyzeTalentDocument({ actor: vendorActor, documentId: uploaded.documentId, consentVersion: "document-analysis-v1", consentedAt: past(1), retentionUntil: future(30) }), /hash does not match/);
    hashFailureVerified = true;
    await db.update(talentApplicationDocuments).set({ sha256: storedDocument.sha256 }).where(eq(talentApplicationDocuments.id, uploaded.documentId));
    delete process.env.KF_TALENT_PROCESSOR_MODE;
    await assert.rejects(() => analyzeTalentDocument({ actor: vendorActor, documentId: uploaded.documentId, consentVersion: "document-analysis-v1", consentedAt: past(1), retentionUntil: future(30) }), /not configured/);
    const [failedAnalysis] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.documentId, uploaded.documentId)).limit(1);
    assert.equal(failedAnalysis.state, "failed");
    assert.equal(failedAnalysis.errorCode, "PROCESSOR_NOT_CONFIGURED");
    assert.deepEqual(failedAnalysis.extractedFieldsJson, {});
    unconfiguredFailureVerified = true;

    process.env.KF_TALENT_PROCESSOR_MODE = "fixture";
    const applicationBeforeAnalysis = await currentApplication(first.applicationId);
    const ready = await analyzeTalentDocument({ actor: vendorActor, documentId: uploaded.documentId, consentVersion: "document-analysis-v1", consentedAt: past(1), retentionUntil: future(30) });
    assert.equal(ready.state, "needs_review");
    assert.equal(ready.processorMode, "sandbox_fixture");
    assert.equal(ready.humanReviewRequired, true);
    await assert.rejects(() => reviewTalentDocumentAnalysis({ actor: vendorActor, analysisId: ready.analysisId, decision: "approved", note: "Self review must fail." }), /Independent human review/);
    await assert.rejects(() => listTalentDocumentAnalysis(financeActor, ready.analysisId), /Finance cannot access/);
    const reviewed = await reviewTalentDocumentAnalysis({ actor: reviewer, analysisId: ready.analysisId, decision: "approved", note: "Independent reviewer checked bounded metadata without changing selection." });
    assert.equal(reviewed.commissionCreated, false);
    const [persistedAnalysis] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, ready.analysisId)).limit(1);
    assert.equal(persistedAnalysis.rawTextPersisted, false);
    assert.equal(persistedAnalysis.automatedDecision, false);
    assert.deepEqual(persistedAnalysis.providersJson, ["metadata_only"]);
    assert.deepEqual(Object.keys(persistedAnalysis.extractedFieldsJson).sort(), ["document_kind", "page_count"]);
    assert.ok(!JSON.stringify(persistedAnalysis).includes(sourceMarker));
    const applicationAfterAnalysis = await currentApplication(first.applicationId);
    assert.equal(applicationAfterAnalysis.currentStage, applicationBeforeAnalysis.currentStage);
    assert.equal(applicationAfterAnalysis.score, applicationBeforeAnalysis.score);
    await withdrawTalentDocumentAnalysis(teamActor, ready.analysisId);
    const [withdrawnAnalysis] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, ready.analysisId)).limit(1);
    assert.equal(withdrawnAnalysis.state, "withdrawn");
    assert.deepEqual(withdrawnAnalysis.extractedFieldsJson, {});
    assert.ok(withdrawnAnalysis.purgedAt);
    await deleteTalentDocument({ actor: teamActor, documentId: uploaded.documentId });

    const deletionApplication = await applyToTalentCampaign({ actor: teamActor, campaignId: documentCampaignId, profile: profile("document-deletion") });
    const deletionUpload = await uploadTalentDocument({ actor: teamActor, applicationId: deletionApplication.applicationId, documentType: "transcript", fileName: `delete-${suffix.slice(0, 6)}.pdf`, contentBase64: source.toString("base64"), contentType: "application/pdf" });
    const deletionAnalysis = await analyzeTalentDocument({ actor: teamActor, documentId: deletionUpload.documentId, consentVersion: "document-analysis-v1", consentedAt: past(1), retentionUntil: future(30) });
    const [deletionDocument] = await db.select().from(talentApplicationDocuments).where(eq(talentApplicationDocuments.id, deletionUpload.documentId)).limit(1);
    await deleteTalentDocument({ actor: teamActor, documentId: deletionUpload.documentId });
    const [purgedDeletion] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, deletionAnalysis.analysisId)).limit(1);
    assert.equal(purgedDeletion.state, "purged");
    assert.deepEqual(purgedDeletion.extractedFieldsJson, {});
    assert.equal(await storage.fileExists({ fileKey: deletionDocument.objectKey }), false);
    deletionVerified = true;

    const consentApplication = await applyToTalentCampaign({ actor: teamActor, campaignId: documentCampaignId, profile: profile("document-consent") });
    const consentUpload = await uploadTalentDocument({ actor: teamActor, applicationId: consentApplication.applicationId, documentType: "certificate", fileName: `consent-${suffix.slice(0, 6)}.pdf`, contentBase64: source.toString("base64"), contentType: "application/pdf" });
    const consentAnalysis = await analyzeTalentDocument({ actor: teamActor, documentId: consentUpload.documentId, consentVersion: "document-analysis-v1", consentedAt: past(1), retentionUntil: future(30) });
    const consentResult = await withdrawTalentConsent({ actor: teamActor, applicantId: consentApplication.applicantId });
    assert.equal(consentResult.purgedAnalyses, 1);
    const [purgedConsent] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, consentAnalysis.analysisId)).limit(1);
    assert.equal(purgedConsent.state, "withdrawn");
    assert.deepEqual(purgedConsent.extractedFieldsJson, {});
    consentWithdrawalVerified = true;

    const retentionApplication = await applyToTalentCampaign({ actor: teamActor, campaignId: documentCampaignId, profile: profile("document-retention") });
    const retentionUpload = await uploadTalentDocument({ actor: teamActor, applicationId: retentionApplication.applicationId, documentType: "course_document", fileName: `retention-${suffix.slice(0, 6)}.pdf`, contentBase64: source.toString("base64"), contentType: "application/pdf" });
    const retentionAnalysis = await analyzeTalentDocument({ actor: teamActor, documentId: retentionUpload.documentId, consentVersion: "document-analysis-v1", consentedAt: past(1), retentionUntil: future(30) });
    await db.update(applicants).set({ retentionUntil: past(1) }).where(eq(applicants.id, retentionApplication.applicantId));
    await enforceTalentRetention({ actor: ops, applicantId: retentionApplication.applicantId });
    const [purgedRetention] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, retentionAnalysis.analysisId)).limit(1);
    assert.equal(purgedRetention.state, "purged");
    assert.deepEqual(purgedRetention.extractedFieldsJson, {});
    retentionVerified = true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "STORAGE_UPSTREAM_ERROR" || code === "STORAGE_NOT_PROVISIONED" || code === "STORAGE_FORBIDDEN") {
      storageDegradation = `${code}: object-storage acceptance could not run in this sandbox`;
    } else throw error;
  } finally {
    if (previousProcessorMode === undefined) delete process.env.KF_TALENT_PROCESSOR_MODE;
    else process.env.KF_TALENT_PROCESSOR_MODE = previousProcessorMode;
  }
  if (!storageDegradation) assert.ok(hashFailureVerified && unconfiguredFailureVerified && deletionVerified && consentWithdrawalVerified && retentionVerified);
  assert.deepEqual(await financialSnapshot(), documentBefore, "Document analysis and privacy operations must not change financial records");

  // Commercial fixtures are isolated from seeded rules and existing attribution.
  async function createProduct(label: string, triggerEvent: "funded" | "renewal", recurrenceMonths: number) {
    const [product] = await db.insert(products).values({ vendorId: vendor.id, vendorRef: uniqueKey(label), name: `Phase 19 ${label}`, category: "fintech", description: "Synthetic sandbox commercial acceptance fixture", priceKobo: 500_000, landingUrl: "https://example.invalid/phase19", pitchScript: "Sandbox only; no live acquisition", status: "active" }).returning();
    const [rule] = await db.insert(commissionRules).values({ productId: product.id, version: 1, basis: "flat", flatAmountKobo: triggerEvent === "renewal" ? 120_000 : 100_000, triggerEvent, recurrenceMonths, recurrenceIntervalMonths: 1, confirmDays: 0, clawbackDays: 60, activationCapPerRepDay: 1000 }).returning();
    return { product, rule };
  }

  async function createActivePromotion(productId: number, label: string) {
    const created = await createPromotion({ actor: vendorActor, name: `Phase 19 ${label}`, productId, campusId: campus.id, brief: "Synthetic external-promotion control fixture; recruitment and funnel observations earn nothing by themselves.", budgetCapKobo: 50_000_000, recruitmentTarget: 10, staffingWarningPct: 80, startsAt: past(1), endsAt: future(90) });
    await submitPromotionReview({ actor: vendorActor, promotionId: created.promotionId, expectedVersion: 1 });
    await reviewPromotion({ actor: reviewer, promotionId: created.promotionId, decision: "approved", note: "Independent promotion commercial and governance review completed." });
    await changePromotionState({ actor: reviewer, promotionId: created.promotionId, action: "start" });
    return created.promotionId;
  }

  const [wallet] = await db.select().from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  if (wallet.balanceKobo < 100_000_000) await db.update(escrowWallets).set({ balanceKobo: 100_000_000 }).where(eq(escrowWallets.vendorId, vendor.id));
  const connectorFixture = await createProduct("connector-funded", "funded", 1);
  const connectorPromotionId = await createActivePromotion(connectorFixture.product.id, "CompanyA onboarding");
  const connectorBefore = await financialSnapshot();
  const connector = await createVendorConnector({ actor: vendorActor, promotionId: connectorPromotionId, name: "CompanyA 10,000-user onboarding", targetCount: 10_000, successEvent: "funded", handoffMode: "signed_link_and_sandbox_provisioning" });
  await assert.rejects(() => reviewVendorConnector({ actor: vendorActor, connectorId: connector.connectorId, decision: "approved", note: "Vendor self review must fail." }), /role|forbidden|required/i);
  await reviewVendorConnector({ actor: reviewer, connectorId: connector.connectorId, decision: "approved", note: "Independent sandbox connector and verified-event boundary review." });
  await activateVendorConnector({ actor: reviewer, connectorId: connector.connectorId });
  const handoff = await createRepresentativeHandoff({ actor: vendorActor, connectorId: connector.connectorId, repId: team.id, consentVersion: "representative-handoff-v1", consentedAt: past(2) });
  assert.equal(handoff.commissionCreated, false);
  const acceptedHandoff = await acceptRepresentativeHandoff({ actor: teamActor, handoffId: handoff.handoffId, origin: "https://example.invalid" });
  assert.ok(acceptedHandoff.link.url.includes("/p/"));
  assert.equal(acceptedHandoff.externalAccountCreation, false);
  await markRepresentativeHandoffProvisioned({ actor: vendorActor, handoffId: handoff.handoffId, evidenceNote: "Synthetic sandbox handoff provisioned; no live CompanyA account was created." });
  assert.deepEqual(await financialSnapshot(), connectorBefore, "Connector setup and representative handoff must not change financial records");

  const rotation = await rotateVendorWebhookCredential(vendorUser.id, vendor.id);
  const [otherVendorUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 19 other vendor ${suffix.slice(0, 4)}`, role: "vendor" }).returning();
  const [otherVendor] = await db.insert(vendors).values({ userId: otherVendorUser.id, companyName: `Phase 19 other vendor ${suffix.slice(0, 4)}`, webhookKey: uniqueKey("other-vendor"), webhookSecret: randomReference("sandbox"), status: "active" }).returning();
  const otherRotation = await rotateVendorWebhookCredential(otherVendorUser.id, otherVendor.id);
  const customerPhone = uniquePhone();
  const externalCustomerRef = `COMPANYA-CUSTOMER-${suffix}`;
  const baseWebhookBody = {
    connector_ref: connector.connectorRef,
    handoff_id: handoff.handoffId,
    event_id: `connector-event-${suffix}`,
    stage: "clicked",
    occurred_at: past(2).toISOString(),
    customer: { phone: customerPhone, customer_ref: externalCustomerRef },
  };
  const stale = await postConnectorProgress(vendor.webhookKey, rotation.secret, baseWebhookBody, Date.now() - 10 * 60_000);
  assert.equal(stale.status, 401);
  const invalidSignature = await postConnectorProgress(vendor.webhookKey, rotation.secret, baseWebhookBody, Date.now(), `sha256=${"0".repeat(64)}`);
  assert.equal(invalidSignature.status, 401);
  const wrongOwner = await postConnectorProgress(otherVendor.webhookKey, otherRotation.secret, baseWebhookBody);
  assert.equal(wrongOwner.status, 404);
  const clicked = await postConnectorProgress(vendor.webhookKey, rotation.secret, baseWebhookBody);
  assert.equal(clicked.status, 202);
  await recordConnectorProgress({ actor: vendorActor, connectorId: connector.connectorId, handoffId: handoff.handoffId, externalEventKey: `registered-${suffix}`, stage: "registered", externalCustomerRef, customerPhone, occurredAt: past(2) });
  await recordConnectorProgress({ actor: vendorActor, connectorId: connector.connectorId, handoffId: handoff.handoffId, externalEventKey: `provisioned-${suffix}`, stage: "provisioned", externalCustomerRef, customerPhone, occurredAt: past(2) });
  const observedProgress = await db.select().from(vendorConnectorProgressEvents).where(eq(vendorConnectorProgressEvents.connectorId, connector.connectorId));
  assert.equal(observedProgress.length, 3);
  assert.ok(observedProgress.every((event) => event.verificationState === "observed" && event.dealId === null));
  assert.deepEqual(await financialSnapshot(), connectorBefore, "Clicks, registrations and provisioning must not create attribution, deals, ledger entries, escrow mutations or payouts");

  const fundedBody = { ...baseWebhookBody, event_id: `funded-${suffix}`, stage: "funded", amount_kobo: 500_000, occurred_at: past(1).toISOString() };
  const funded = await postConnectorProgress(vendor.webhookKey, rotation.secret, fundedBody);
  assert.equal(funded.status, 202);
  const fundedResult = await funded.json() as { dealId: number; state: string; ingestionStatus: string; commissionCreated: boolean };
  assert.equal(fundedResult.state, "vendor_verified");
  assert.equal(fundedResult.ingestionStatus, "accepted");
  assert.equal(fundedResult.commissionCreated, true);
  assert.ok(fundedResult.dealId);
  const fundedReplay = await postConnectorProgress(vendor.webhookKey, rotation.secret, fundedBody);
  assert.equal(fundedReplay.status, 200);
  assert.equal((await fundedReplay.json() as { idempotent: boolean }).idempotent, true);
  const [mapping] = await db.select().from(vendorExternalCustomerMappings).where(eq(vendorExternalCustomerMappings.connectorId, connector.connectorId)).limit(1);
  assert.equal(mapping.pseudonymHash.length, 64);
  assert.equal(mapping.customerPhoneHash.length, 64);
  assert.equal(mapping.customerRefHash.length, 64);
  assert.ok(!JSON.stringify(mapping).includes(customerPhone) && !JSON.stringify(mapping).includes(externalCustomerRef));
  const [connectorDeal] = await db.select().from(deals).where(eq(deals.id, fundedResult.dealId)).limit(1);
  assert.equal(connectorDeal.repId, team.id);
  assert.equal(connectorDeal.vendorCommissionKobo, 100_000);
  assert.equal(connectorDeal.repCommissionKobo, 80_000);
  assert.equal(connectorDeal.platformFeeKobo, 20_000);
  await confirmDueDeals(opsUser.id);
  const managerWorkspace = await listVendorConnectorWorkspace(vendorActor);
  const managerMetric = managerWorkspace.metrics.find((metric) => metric.connectorId === connector.connectorId);
  assert.equal(managerMetric?.clicked, 1);
  assert.equal(managerMetric?.registered, 1);
  assert.equal(managerMetric?.vendorVerified, 1);
  assert.equal(managerMetric?.acceptedDeals, 1);
  assert.equal(managerMetric?.confirmedSuccessActivations, 1);
  const representativeWorkspace = await listVendorConnectorWorkspace(teamActor);
  const representativeMetric = representativeWorkspace.metrics.find((metric) => metric.connectorId === connector.connectorId);
  assert.equal(representativeMetric?.clicked, null);
  assert.equal(representativeMetric?.registered, null);
  assert.equal(representativeMetric?.acceptedDeals, null);
  const [progressToTamper] = await db.select().from(vendorConnectorProgressEvents).where(eq(vendorConnectorProgressEvents.dealId, fundedResult.dealId)).limit(1);
  await assert.rejects(() => db.update(vendorConnectorProgressEvents).set({ payloadHash: "tamper" }).where(eq(vendorConnectorProgressEvents.id, progressToTamper.id)), isAppendOnlyError);
  const [storedHandoff] = await db.select().from(vendorRepresentativeHandoffs).where(eq(vendorRepresentativeHandoffs.id, handoff.handoffId)).limit(1);
  assert.equal(storedHandoff.state, "activated");
  const [storedConnector] = await db.select().from(vendorOnboardingConnectors).where(eq(vendorOnboardingConnectors.id, connector.connectorId)).limit(1);
  assert.equal(storedConnector.executionMode, "sandbox");
  assert.equal(storedConnector.externalAccountCreation, false);

  // Recurrence preserves original first-touch attribution and commission-rule versions.
  const recurrenceFixture = await createProduct("renewal-recurrence", "renewal", 2);
  const recurrencePromotionId = await createActivePromotion(recurrenceFixture.product.id, "Evidence-gated renewals");
  const recurrenceLink = await createPromotionLink({ actor: teamActor, promotionId: recurrencePromotionId, origin: "https://example.invalid" });
  const recurrenceCustomerPhone = uniquePhone();
  const recurrenceCustomerRef = `RENEWAL-CUSTOMER-${suffix}`;
  const renewalPayload = (eventId: string) => ({
    event_id: eventId,
    type: "renewal" as const,
    occurred_at: past(1).toISOString(),
    customer: { phone: recurrenceCustomerPhone, customer_ref: recurrenceCustomerRef },
    product_ref: recurrenceFixture.product.vendorRef,
    amount_kobo: 500_000,
    meta: { execution_mode: "sandbox" },
  });
  const firstRenewal = await ingestWithDurableRetry(vendor.webhookKey, renewalPayload(`initial-renewal-${suffix}`), { promotionLinkId: recurrenceLink.linkId });
  assert.equal(firstRenewal.status, "accepted");
  const firstDealId = "deal_id" in firstRenewal ? firstRenewal.deal_id : null;
  assert.ok(firstDealId);
  const [schedule] = await db.select().from(commissionRecurrenceSchedules).where(eq(commissionRecurrenceSchedules.originalDealId, firstDealId)).limit(1);
  assert.equal(schedule.cycleNumber, 1);
  assert.equal(schedule.maxCycles, 2);
  assert.equal(schedule.intervalMonths, 1);
  assert.equal(schedule.state, "scheduled");
  assert.equal(schedule.repId, team.id);
  assert.equal(schedule.commissionRuleId, recurrenceFixture.rule.id);
  const earlyBefore = await financialSnapshot();
  const earlyRenewal = await ingestWithDurableRetry(vendor.webhookKey, renewalPayload(`early-renewal-${suffix}`), { promotionLinkId: recurrenceLink.linkId });
  assert.equal(earlyRenewal.status, "ignored");
  assert.match("reason" in earlyRenewal ? earlyRenewal.reason || "" : "", /before the next eligible cycle/);
  assert.deepEqual(await financialSnapshot(), earlyBefore, "Early renewal evidence must not create another financial cycle");

  await db.update(commissionRules).set({ supersededAt: new Date() }).where(eq(commissionRules.id, recurrenceFixture.rule.id));
  const [replacementRule] = await db.insert(commissionRules).values({ productId: recurrenceFixture.product.id, version: 2, basis: "flat", flatAmountKobo: 240_000, triggerEvent: "renewal", recurrenceMonths: 4, recurrenceIntervalMonths: 2, confirmDays: 0, clawbackDays: 60, activationCapPerRepDay: 1000 }).returning();
  await db.update(commissionRecurrenceSchedules).set({ nextDueAt: past(1) }).where(eq(commissionRecurrenceSchedules.id, schedule.id));
  const sweepBefore = await financialSnapshot();
  await assert.rejects(() => runRecurrenceSweep(financeActor), /FORBIDDEN|role|vendor|Operations|not allowed/i);
  const sweep = await runRecurrenceSweep(ops);
  assert.equal(sweep.awaitingEvidence, 1);
  assert.equal(sweep.dealsCreated, 0);
  assert.equal(sweep.ledgerEntriesCreated, 0);
  assert.equal(sweep.evidenceRequired, true);
  assert.deepEqual(await financialSnapshot(), sweepBefore, "A recurrence sweep must create no financial records");
  const dueRenewal = await ingestWithDurableRetry(vendor.webhookKey, renewalPayload(`due-renewal-${suffix}`), { promotionLinkId: recurrenceLink.linkId });
  assert.equal(dueRenewal.status, "accepted");
  const secondDealId = "deal_id" in dueRenewal ? dueRenewal.deal_id : null;
  assert.ok(secondDealId);
  const [secondDeal] = await db.select().from(deals).where(eq(deals.id, secondDealId)).limit(1);
  assert.equal(secondDeal.repId, team.id);
  assert.equal(secondDeal.commissionRuleId, recurrenceFixture.rule.id);
  assert.notEqual(secondDeal.commissionRuleId, replacementRule.id);
  assert.equal(secondDeal.vendorCommissionKobo, 120_000);
  assert.equal(secondDeal.repCommissionKobo, 96_000);
  assert.equal(secondDeal.platformFeeKobo, 24_000);
  const [completedSchedule] = await db.select().from(commissionRecurrenceSchedules).where(eq(commissionRecurrenceSchedules.id, schedule.id)).limit(1);
  assert.equal(completedSchedule.cycleNumber, 2);
  assert.equal(completedSchedule.state, "completed");
  assert.equal(completedSchedule.lastDealId, secondDealId);
  assert.equal(completedSchedule.nextDueAt, null);
  const capBefore = await financialSnapshot();
  const cappedRenewal = await ingestWithDurableRetry(vendor.webhookKey, renewalPayload(`capped-renewal-${suffix}`), { promotionLinkId: recurrenceLink.linkId });
  assert.equal(cappedRenewal.status, "ignored");
  assert.match("reason" in cappedRenewal ? cappedRenewal.reason || "" : "", /limit reached/);
  assert.deepEqual(await financialSnapshot(), capBefore, "Exhausted recurrence schedules must not create another deal");
  const receipts = await db.select().from(commissionRecurrenceReceipts).where(eq(commissionRecurrenceReceipts.scheduleId, schedule.id)).orderBy(asc(commissionRecurrenceReceipts.id));
  assert.equal(receipts.filter((receipt) => receipt.receiptType === "verified_renewal").length, 2);
  assert.equal(receipts.filter((receipt) => receipt.receiptType === "awaiting_evidence").length, 1);
  await assert.rejects(() => db.update(commissionRecurrenceReceipts).set({ detail: "tamper" }).where(eq(commissionRecurrenceReceipts.id, receipts[0].id)), isAppendOnlyError);
  const recurrenceWorkspace = await listRecurrenceWorkspace(financeActor);
  assert.ok(recurrenceWorkspace.schedules.some((row) => row.schedule.id === schedule.id));
  assert.equal(recurrenceWorkspace.controls.standardRepShareBps, 8000);
  assert.equal(recurrenceWorkspace.controls.platformShareBps, 2000);
  assert.equal(recurrenceWorkspace.controls.campusLeadOverrideBps, 500);
  assert.equal(recurrenceWorkspace.controls.historicalRulesPreserved, true);

  console.log(JSON.stringify({
    phase: 19,
    status: storageDegradation ? "passed_with_external_storage_degradation" : "passed",
    institutionalCampaigns: institutionalTypes.length,
    institutionalOutcomes: institutionalTypes.map((item) => item.outcome),
    independentGovernancePartnerAndOutcomeReview: true,
    enforcedStudyLevelAndGraduationEligibility: true,
    documentAnalysis: storageDegradation ? {
      status: "degraded_external_storage_unavailable",
      detail: storageDegradation,
      realPaddleOcrDoclingVlmExecuted: false,
    } : {
      objectStorageAndHashValidation: true,
      unconfiguredProcessorFailedClosed: true,
      sandboxFixture: "metadata_only_no_ocr",
      boundedPersistenceAndIndependentHumanReview: true,
      withdrawalDeletionConsentAndRetentionPurges: true,
      realPaddleOcrDoclingVlmExecuted: false,
    },
    connector: {
      target: 10_000,
      signedFirstTouchHandoff: true,
      hmacTimestampOwnershipAndReplayControls: true,
      observedEventsCreatedNoFinance: 3,
      verifiedFundedActivationCreatedDeal: true,
      confirmedTargetOutcomes: 1,
      rawCustomerIdentifiersPersisted: false,
      liveExternalAccountCreation: false,
    },
    recurrence: {
      initialVerifiedCycle: 1,
      earlyRenewalIgnored: true,
      sweepCreatedDeals: 0,
      sweepCreatedLedgerEntries: 0,
      dueVerifiedCycle: 2,
      maximumCycleCapEnforced: true,
      originalRepresentativeAndRulePreserved: true,
      appendOnlyReceipts: true,
    },
    financialPreservation: ["institutional", "document_intelligence", "observed_connector_events", "recurrence_sweeps", "early_and_exhausted_renewals"],
    productionReady: false,
    boundary: "Local synthetic PostgreSQL sandbox acceptance only; not provider, institutional, production, identity, scale or real-recruitment certification.",
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
