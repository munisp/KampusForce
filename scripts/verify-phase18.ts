import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import {
  applicants,
  attributionRecords,
  campuses,
  deals,
  escrowWallets,
  ledgerEntries,
  payouts,
  products,
  reps,
  talentApplicationDocuments,
  talentApplicationEvents,
  talentApplications,
  talentOffers,
  users,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import { storage } from "../api/lib/storage";
import { salesActorForUser } from "../api/services/salesAccess";
import {
  activateTalentCampaign,
  applyToTalentCampaign,
  bulkApplyToTalentCampaign,
  createTalentCampaign,
  enforceTalentRetention,
  exportTalentCampaign,
  listTalentWorkspace,
  reviewTalentCampaign,
  submitTalentCampaign,
  withdrawTalentConsent,
  type ApplicantProfileInput,
} from "../api/services/talentCampaigns";
import {
  advanceTalentApplication,
  createTalentAssessment,
  createTalentOffer,
  deleteTalentDocument,
  issueTalentOffer,
  respondToTalentOffer,
  reviewTalentAssessment,
  scheduleTalentInterview,
  scoreTalentInterview,
  submitTalentAssessment,
  talentDocumentUrl,
  uploadTalentDocument,
  verifyTalentOutcome,
} from "../api/services/talentApplications";
import type { TalentCampaignType } from "../api/services/talentAccess";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
let phoneCounter = 0;
const uniquePhone = () => `+23496${String(Date.now() + phoneCounter++).slice(-8)}`;
const uniqueKey = (label: string) => `p18-${label}-${suffix.slice(0, 10)}`;
const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const future = (days: number) => new Date(Date.now() + days * 86_400_000);

async function financialSnapshot() {
  const [dealRows, attributionRows, ledgerRows, escrowRows, payoutRows] = await Promise.all([
    db.select().from(deals).orderBy(asc(deals.id)), db.select().from(attributionRecords).orderBy(asc(attributionRecords.id)),
    db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.id)), db.select().from(escrowWallets).orderBy(asc(escrowWallets.vendorId)), db.select().from(payouts).orderBy(asc(payouts.id)),
  ]);
  return { dealRows, attributionRows, ledgerRows, escrowRows, payoutRows };
}

async function makeOperationsUser(label: string) {
  const [user] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 18 ${label} ${suffix.slice(0, 5)}`, role: "ops" }).returning();
  return { user, actor: await salesActorForUser(user) };
}

async function currentApplication(applicationId: number) {
  const [application] = await db.select().from(talentApplications).where(eq(talentApplications.id, applicationId)).limit(1);
  assert.ok(application);
  return application;
}

async function main() {
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, product?.vendorId)).limit(1);
  const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor?.userId ?? -1)).limit(1);
  const [team] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  const [teamUser] = await db.select().from(users).where(eq(users.id, team?.userId)).limit(1);
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, team?.campusId)).limit(1);
  const [otherCampus] = await db.select().from(campuses).where(eq(campuses.id, campus?.id === 1 ? 2 : 1)).limit(1);
  const [financeUser] = await db.select().from(users).where(eq(users.role, "finance")).limit(1);
  assert.ok(vendor && vendorUser && team && teamUser && campus && otherCampus && financeUser);
  const { user: opsUser, actor: ops } = await makeOperationsUser("Operator");
  const { actor: reviewer } = await makeOperationsUser("Reviewer");
  const vendorActor = await salesActorForUser(vendorUser);
  const teamActor = await salesActorForUser(teamUser);
  const financeActor = await salesActorForUser(financeUser);
  const [outsiderUser] = await db.insert(users).values({ phoneE164: uniquePhone(), name: `Phase 18 Outsider ${suffix.slice(0, 4)}`, role: "rep" }).returning();
  await db.insert(reps).values({ userId: outsiderUser.id, campusId: otherCampus.id, code: uniqueKey("outsider").slice(0, 32), status: "active" });
  const outsider = await salesActorForUser(outsiderUser);
  const before = await financialSnapshot();
  const profile = (label: string, course = "Geology"): ApplicantProfileInput => ({ campusId: campus.id, fullName: `Synthetic ${label}`, email: `${uniqueKey(label)}@example.test`, course, studyLevel: "Undergraduate", graduationYear: new Date().getFullYear() + 1, consentVersion: "phase18-consent-v1", consentedAt: past(5), retentionUntil: future(730) });

  async function createActiveCampaign(campaignType: TalentCampaignType, targetCount: number, creator: "ops" | "vendor" = "vendor") {
    const actor = creator === "ops" ? ops : vendorActor;
    const created = await createTalentCampaign({ actor, vendorId: creator === "ops" ? vendor.id : undefined, title: `${uniqueKey(campaignType)} campaign`, campaignType, summary: "Synthetic consented campus opportunity with independently verified non-financial outcomes.", targetCount, eligibleCourses: ["Geology", "Mathematics"], startsAt: past(10), endsAt: future(90), targets: [{ campusId: campus.id, targetCount }] });
    await submitTalentCampaign({ actor, campaignId: created.campaignId, expectedVersion: 1 });
    if (creator === "ops") await assert.rejects(() => reviewTalentCampaign({ actor: ops, campaignId: created.campaignId, decision: "approved", note: "Self review must fail." }), /Independent review/);
    await reviewTalentCampaign({ actor: reviewer, campaignId: created.campaignId, decision: "approved", note: "Independent eligibility, consent and non-financial boundary review." });
    await activateTalentCampaign({ actor: reviewer, campaignId: created.campaignId });
    return created.campaignId;
  }

  async function submitApplication(campaignId: number, label: string, course = "Geology") {
    return applyToTalentCampaign({ actor: teamActor, campaignId, profile: profile(label, course) });
  }

  async function advance(applicationId: number, toStage: "screening" | "offer" | "accepted" | "rejected") {
    const current = await currentApplication(applicationId);
    return advanceTalentApplication({ actor: ops, applicationId, expectedVersion: current.version, toStage, reason: `Reviewed transition to ${toStage} against campaign criteria.` });
  }

  async function signedOffer(applicationId: number) {
    const offer = await createTalentOffer({ actor: vendorActor, applicationId, title: "Synthetic selection offer", termsSummary: "Sandbox terms only; no employment, payment or commission commitment.", expiresAt: future(14) });
    const issued = await issueTalentOffer({ actor: vendorActor, offerId: offer.id, expectedVersion: offer.version });
    const [stored] = await db.select().from(talentOffers).where(eq(talentOffers.id, offer.id)).limit(1);
    assert.ok(!JSON.stringify(stored).includes(issued.acceptanceToken));
    const response = await respondToTalentOffer({ acceptanceToken: issued.acceptanceToken, decision: "accepted" });
    assert.equal(response.applicationStage, "accepted");
    await assert.rejects(() => respondToTalentOffer({ acceptanceToken: issued.acceptanceToken, decision: "accepted" }), /already been responded/);
    return response;
  }

  async function verify(applicationId: number) {
    await assert.rejects(() => verifyTalentOutcome({ actor: ops, applicationId, observedByUserId: opsUser.id, evidenceNote: "Self observation must fail.", observedAt: past(1) }), /independent/);
    return verifyTalentOutcome({ actor: ops, applicationId, observedByUserId: vendorUser.id, evidenceNote: "Independent observer evidence reviewed; no commercial activation created.", observedAt: past(1) });
  }

  // Full graduate recruitment journey: application, assessment, interview, signed offer and verified hire.
  const recruitmentCampaignId = await createActiveCampaign("recruitment", 1000, "ops");
  const recruitment = await submitApplication(recruitmentCampaignId, "graduate");
  assert.equal(recruitment.commissionCreated, false);
  await assert.rejects(() => submitApplication(recruitmentCampaignId, "graduate"), /already exists/);
  await advance(recruitment.applicationId, "screening");
  const assessment = await createTalentAssessment({ actor: ops, applicationId: recruitment.applicationId, kind: "geology", title: "Geology and mathematical reasoning", questions: [{ id: "q1", prompt: "Validate a field model.", maxScore: 50 }, { id: "q2", prompt: "Quantify uncertainty.", maxScore: 50 }] });
  await assert.rejects(() => submitTalentAssessment({ actor: teamActor, assessmentId: assessment.id, responses: { q1: "Incomplete" } }), /Answer every/);
  await submitTalentAssessment({ actor: teamActor, assessmentId: assessment.id, responses: { q1: "Triangulate independent field observations.", q2: "Use sensitivity analysis and confidence intervals." } });
  await assert.rejects(() => reviewTalentAssessment({ actor: teamActor, assessmentId: assessment.id, score: 90, rubricNote: "Self scoring must fail." }), /vendor or Operations/);
  const reviewedAssessment = await reviewTalentAssessment({ actor: vendorActor, assessmentId: assessment.id, score: 90, rubricNote: "Strong evidence-based reasoning across both rubric criteria." });
  assert.equal(reviewedAssessment.independentlyReviewed, true);
  const interview = await scheduleTalentInterview({ actor: ops, applicationId: recruitment.applicationId, scheduledAt: future(2), durationMinutes: 45, mode: "virtual", location: "sandbox-interview-room", interviewerUserId: opsUser.id });
  await assert.rejects(() => scheduleTalentInterview({ actor: vendorActor, applicationId: recruitment.applicationId, scheduledAt: future(2), durationMinutes: 45, mode: "virtual", location: "overlap", interviewerUserId: vendorUser.id }), /screened|overlapping/);
  await scoreTalentInterview({ actor: ops, interviewId: interview.id, scorecard: { technical: 92, communication: 88, teamwork: 90 }, recommendation: "strong_yes", notes: "Consistent structured evidence across all competencies." });
  await advance(recruitment.applicationId, "offer");
  await signedOffer(recruitment.applicationId);
  const hire = await verify(recruitment.applicationId);
  assert.equal(hire.outcomeType, "hire");
  assert.equal(hire.dealCreated, false);
  await assert.rejects(() => advanceTalentApplication({ actor: outsider, applicationId: recruitment.applicationId, expectedVersion: 1, toStage: "rejected", reason: "Unauthorized scope test" }), /not found|FORBIDDEN|vendor or Operations/i);

  // Internship repeats the interview/offer path; scholarships and fellowships use award offers.
  const selectionTypes: TalentCampaignType[] = ["internship", "scholarship", "fellowship"];
  for (const campaignType of selectionTypes) {
    const campaignId = await createActiveCampaign(campaignType, 1);
    const application = await submitApplication(campaignId, campaignType, "Mathematics");
    await advance(application.applicationId, "screening");
    if (campaignType === "internship") {
      const scheduled = await scheduleTalentInterview({ actor: ops, applicationId: application.applicationId, scheduledAt: future(3), durationMinutes: 30, mode: "in_person", location: "Campus interview room", interviewerUserId: opsUser.id });
      const conflicting = await submitApplication(campaignId, "interview-conflict", "Mathematics");
      await advance(conflicting.applicationId, "screening");
      await assert.rejects(() => scheduleTalentInterview({ actor: ops, applicationId: conflicting.applicationId, scheduledAt: future(3), durationMinutes: 30, mode: "virtual", location: "Conflicting room", interviewerUserId: opsUser.id }), /overlapping/);
      await scoreTalentInterview({ actor: ops, interviewId: scheduled.id, scorecard: { technical: 85, communication: 86, teamwork: 88 }, recommendation: "yes", notes: "Structured internship readiness evidence." });
    }
    await advance(application.applicationId, "offer");
    await signedOffer(application.applicationId);
    const outcome = await verify(application.applicationId);
    assert.equal(outcome.applicationStage, "completed");
    assert.equal(outcome.outcomeType, campaignType === "internship" ? "placement" : campaignType === "scholarship" ? "award" : "fellowship");
  }

  // New direct-participant campaign types: registration/selection followed by independent completion evidence.
  const directTypes: { type: TalentCampaignType; outcome: string }[] = [
    { type: "campus_event", outcome: "attendance" }, { type: "research", outcome: "research_completion" },
    { type: "training", outcome: "learning_completion" }, { type: "waitlist", outcome: "early_access" },
  ];
  let waitlistCampaignId = 0;
  for (const item of directTypes) {
    const campaignId = await createActiveCampaign(item.type, 1);
    if (item.type === "waitlist") waitlistCampaignId = campaignId;
    const application = await submitApplication(campaignId, item.type, "Mathematics");
    await advance(application.applicationId, "accepted");
    const outcome = await verify(application.applicationId);
    assert.equal(outcome.outcomeType, item.outcome);
    assert.equal(outcome.commissionCreated, false);
  }

  // Reviewed applicant-document object lifecycle, including actual browser-byte verification.
  const documentText = `Phase 18 synthetic CV ${suffix}\nNo government identifier or live applicant claim.`;
  let documentId: number | null = null;
  let documentDeleted = false;
  try {
    const uploaded = await uploadTalentDocument({ actor: teamActor, applicationId: recruitment.applicationId, documentType: "cv", fileName: `cv-${suffix.slice(0, 6)}.txt`, contentBase64: Buffer.from(documentText).toString("base64"), contentType: "text/plain" });
    documentId = uploaded.documentId;
    const [storedDocument] = await db.select().from(talentApplicationDocuments).where(eq(talentApplicationDocuments.id, documentId)).limit(1);
    assert.equal(storedDocument.reviewStatus, "active");
    assert.ok(!JSON.stringify(storedDocument).includes("http"));
    assert.equal(await storage.fileExists({ fileKey: storedDocument.objectKey }), true);
    assert.equal((await storage.headFile({ fileKey: storedDocument.objectKey })).size, Buffer.byteLength(documentText));
    const listed = await storage.listFiles({ prefix: `talent/${recruitment.applicationId}/`, delimiter: "", maxKeys: 100 });
    assert.ok(listed.objects.some((object) => object.key === storedDocument.objectKey));
    await assert.rejects(() => talentDocumentUrl({ actor: outsider, documentId: documentId! }), /not found/);
    await assert.rejects(() => talentDocumentUrl({ actor: financeActor, documentId: documentId! }), /does not include/);
    const temporary = await talentDocumentUrl({ actor: teamActor, documentId });
    const metadataPath = `/tmp/kampusforce-phase18-storage-${suffix}.json`;
    writeFileSync(metadataPath, JSON.stringify({ url: temporary.url, expectedText: documentText }));
    try {
      const browser = spawnSync("python3", ["scripts/verify-phase17-storage-browser.py", metadataPath], { cwd: process.cwd(), encoding: "utf-8", timeout: 120_000 });
      if (browser.status !== 0) throw new Error(`Document browser verification failed: ${browser.stderr || browser.stdout}`);
      assert.ok(browser.stdout.includes("storageBrowserContentMatched"));
    } finally { rmSync(metadataPath, { force: true }); }
    await deleteTalentDocument({ actor: teamActor, documentId });
    documentDeleted = true;
    assert.equal(await storage.fileExists({ fileKey: storedDocument.objectKey }), false);
  } finally {
    if (documentId && !documentDeleted) await deleteTalentDocument({ actor: ops, documentId }).catch(() => undefined);
  }

  // Consent withdrawal and retention are privacy operations, never financial reversals.
  const withdrawal = await submitApplication(waitlistCampaignId, "consent-withdrawal", "Mathematics").catch(async () => {
    const campaignId = await createActiveCampaign("waitlist", 10);
    return submitApplication(campaignId, "consent-withdrawal", "Mathematics");
  });
  const withdrawn = await withdrawTalentConsent({ actor: teamActor, applicantId: withdrawal.applicantId });
  assert.equal(withdrawn.withdrawnApplications, 1);
  assert.equal((await currentApplication(withdrawal.applicationId)).currentStage, "withdrawn");
  const retentionCampaignId = await createActiveCampaign("research", 10);
  const retained = await submitApplication(retentionCampaignId, "retention", "Mathematics");
  const marker = `retention-${suffix}@example.test`;
  await db.update(applicants).set({ email: marker, normalizedEmail: marker, retentionUntil: past(1) }).where(eq(applicants.id, retained.applicantId));
  const enforced = await enforceTalentRetention({ actor: ops, applicantId: retained.applicantId });
  assert.equal(enforced.anonymized, true);
  const [anonymized] = await db.select().from(applicants).where(eq(applicants.id, retained.applicantId)).limit(1);
  assert.ok(!JSON.stringify(anonymized).includes(marker));
  const [history] = await db.select().from(talentApplicationEvents).where(and(eq(talentApplicationEvents.applicationId, retained.applicationId), eq(talentApplicationEvents.eventType, "retention_enforced"))).limit(1);
  await assert.rejects(() => db.update(talentApplicationEvents).set({ note: "tamper" }).where(eq(talentApplicationEvents.id, history.id)), (error: unknown) => {
    const cause = (error as { cause?: Error }).cause;
    assert.match(cause?.message || "", /append-only/);
    return true;
  });

  // A real 1,000-row application batch with idempotent replay and sandbox-only ATS/HR export.
  const rows: ApplicantProfileInput[] = Array.from({ length: 1000 }, (_, index) => profile(`bulk-${index}`, index % 2 ? "Geology" : "Mathematics"));
  const importRef = `KF-IMPORT-${suffix}`;
  const batch = await bulkApplyToTalentCampaign({ actor: vendorActor, campaignId: recruitmentCampaignId, importRef, rows });
  assert.equal(batch.rowsCreated, 1000);
  assert.equal(batch.duplicatesRejected, 0);
  const replay = await bulkApplyToTalentCampaign({ actor: vendorActor, campaignId: recruitmentCampaignId, importRef, rows });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.rowsCreated, 1000);
  const exported = await exportTalentCampaign({ actor: vendorActor, campaignId: recruitmentCampaignId, destination: "generic_ats" });
  assert.equal(exported.rowCount, 1001);
  assert.equal(exported.externalExecution, false);
  assert.equal(exported.payloadHash.length, 64);
  assert.ok(exported.csv.includes("applicationRef"));

  const financeWorkspace = await listTalentWorkspace(financeActor);
  assert.equal(financeWorkspace.applications.length, 0);
  assert.equal(financeWorkspace.documents.length, 0);
  assert.ok(financeWorkspace.metrics.offersAccepted >= 4);
  assert.equal(financeWorkspace.capabilities.readOnly, true);
  const repWorkspace = await listTalentWorkspace(teamActor);
  assert.ok(repWorkspace.applications.some((row) => row.application.id === recruitment.applicationId));
  const outsiderWorkspace = await listTalentWorkspace(outsider);
  assert.ok(!outsiderWorkspace.applications.some((row) => row.application.id === recruitment.applicationId));
  assert.deepEqual(await financialSnapshot(), before, "ATS and opportunity outcomes must not mutate deals, attribution, ledger, escrow or payouts");

  console.log(JSON.stringify({
    phase: 18,
    status: "passed",
    campaignTypes: ["recruitment", "internship", "scholarship", "fellowship", "campus_event", "research", "training", "waitlist"],
    verifiedOutcomes: ["hire", "placement", "award", "fellowship", "attendance", "research_completion", "learning_completion", "early_access"],
    fullAtsJourney: true,
    independentCampaignAssessmentOutcomeReview: true,
    signedOfferTokenPersisted: false,
    signedOfferReplayRejected: true,
    roleIsolationAndFinancePiiBoundary: true,
    immutableApplicationHistory: true,
    consentWithdrawalAndRetention: true,
    storageUploadReview: "active",
    storageIndependentReads: true,
    storageBrowserContentMatched: true,
    storageDeletedAndRechecked: true,
    bulkImport: { rowsCreated: batch.rowsCreated, elapsedMs: batch.elapsedMs, idempotentReplay: true, boundary: "local_sandbox_not_provider_or_production_certification" },
    atsExport: { rows: exported.rowCount, externalExecution: exported.externalExecution, payloadHashRecorded: true },
    financialPreservation: ["deals", "attribution", "ledger", "escrow", "payouts"],
    productionReady: false,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
