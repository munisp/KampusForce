import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  talentApplicationDocuments,
  talentApplications,
  talentAssessments,
  talentCampaigns,
  talentInterviews,
  talentOffers,
  talentOutcomes,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { storage } from "../lib/storage";
import {
  accessibleTalentApplication,
  appendTalentEvent,
  assertTalentOperations,
  assertTalentWritable,
  campaignOutcomeType,
  campaignSupportsSelection,
  talentHash,
  talentRef,
  type TalentStage,
} from "./talentAccess";
import type { SalesActor } from "./salesAccess";
import { assessmentResponsesComplete, directParticipantAcceptanceAllowed, signedOfferResponseProblem } from "./talentPolicy";
import { purgeTalentDocumentAnalysis } from "./talentDocumentIntelligence";

function assertSelectionManager(actor: SalesActor) {
  assertTalentWritable(actor);
  if (!["vendor", "ops", "admin"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the campaign vendor or Operations can make selection decisions" });
}

export async function advanceTalentApplication(input: { actor: SalesActor; applicationId: number; expectedVersion: number; toStage: "screening" | "offer" | "accepted" | "rejected"; reason: string }) {
  assertSelectionManager(input.actor);
  const { application, campaign } = await accessibleTalentApplication(input.actor, input.applicationId);
  if (["completed", "withdrawn", "rejected"].includes(application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "A closed application cannot advance" });
  if (input.toStage === "screening" && application.currentStage !== "submitted") throw new TRPCError({ code: "CONFLICT", message: "Only a submitted application can enter screening" });
  if (input.toStage === "offer") {
    if (!campaignSupportsSelection(campaign.campaignType) || !["screening", "assessment", "interview"].includes(application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "This campaign or application stage does not support an offer" });
    if (["recruitment", "internship"].includes(campaign.campaignType)) {
      const interviews = await getDb().select().from(talentInterviews).where(eq(talentInterviews.applicationId, application.id));
      if (!interviews.some((interview) => interview.state === "completed")) throw new TRPCError({ code: "BAD_REQUEST", message: "A completed interview scorecard is required before a hiring offer" });
    }
  }
  if (input.toStage === "accepted" && !directParticipantAcceptanceAllowed(campaign.campaignType, application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "Selection campaigns accept candidates through the signed offer response; direct programs accept from an early review stage" });
  const [updated] = await getDb().update(talentApplications).set({ currentStage: input.toStage, decisionReason: input.reason, version: application.version + 1, updatedAt: new Date() }).where(and(eq(talentApplications.id, application.id), eq(talentApplications.version, input.expectedVersion))).returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Application changed elsewhere; refresh before advancing" });
  await appendTalentEvent(application.id, input.actor.userId, "stage_advanced", input.reason, application.currentStage, input.toStage, { financialEntitlement: false });
  return { applicationId: application.id, stage: updated.currentStage, version: updated.version, commissionCreated: false };
}

const allowedDocumentTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv"]);
const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function documentMatchesType(bytes: Buffer, contentType: string) {
  const hex = bytes.subarray(0, 12).toString("hex");
  if (contentType === "image/png") return hex.startsWith("89504e470d0a1a0a");
  if (contentType === "image/jpeg") return hex.startsWith("ffd8ff");
  if (contentType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  try { return !new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0"); } catch { return false; }
}

export async function uploadTalentDocument(input: { actor: SalesActor; applicationId: number; documentType: "cv" | "transcript" | "course_document" | "certificate" | "other"; fileName: string; contentBase64: string; contentType: string }) {
  assertTalentWritable(input.actor);
  const { application } = await accessibleTalentApplication(input.actor, input.applicationId);
  if (["rejected", "withdrawn"].includes(application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "Documents cannot be added to this closed application" });
  if (!allowedDocumentTypes.has(input.contentType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Document type is not allowed" });
  const hasControl = [...input.fileName].some((character) => character.charCodeAt(0) <= 31);
  if (!input.fileName.trim() || /[/\\]/.test(input.fileName) || hasControl || input.fileName === "." || input.fileName === "..") throw new TRPCError({ code: "BAD_REQUEST", message: "Use a plain filename without paths or control characters" });
  if (input.contentBase64.length % 4 !== 0 || !canonicalBase64.test(input.contentBase64)) throw new TRPCError({ code: "BAD_REQUEST", message: "Document content must be canonical base64" });
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Document must be non-empty and no larger than 100 MB" });
  if (!documentMatchesType(bytes, input.contentType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Document bytes do not match the declared content type" });
  const saved = await storage.uploadFile({ fileContent: new Uint8Array(bytes), fileName: `talent/${application.id}/${input.fileName}`, contentType: input.contentType });
  try {
    const [document] = await getDb().insert(talentApplicationDocuments).values({ applicationId: application.id, documentType: input.documentType, objectKey: saved.key, fileName: input.fileName, contentType: saved.contentType, size: saved.size, sha256: createHash("sha256").update(bytes).digest("hex"), reviewStatus: saved.reviewStatus, uploadedByUserId: input.actor.userId }).returning();
    await appendTalentEvent(application.id, input.actor.userId, "reviewed_document_added", `${input.documentType} passed synchronous storage review`, application.currentStage, application.currentStage, { documentId: document.id, sha256: document.sha256, presignedUrlPersisted: false });
    return { documentId: document.id, reviewStatus: document.reviewStatus, size: document.size, objectKeyPersisted: true, presignedUrlPersisted: false };
  } catch (error) {
    await storage.deleteFile({ fileKey: saved.key });
    throw error;
  }
}

export async function talentDocumentUrl(input: { actor: SalesActor; documentId: number }) {
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance oversight does not include applicant documents" });
  const [document] = await getDb().select().from(talentApplicationDocuments).where(eq(talentApplicationDocuments.id, input.documentId)).limit(1);
  if (!document || document.deletedAt || document.purgedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  await accessibleTalentApplication(input.actor, document.applicationId);
  const { url } = await storage.getPresignedUrl({ key: document.objectKey });
  return { url, fileName: document.fileName, contentType: document.contentType, persisted: false, expiresInMinutes: 10 };
}

export async function deleteTalentDocument(input: { actor: SalesActor; documentId: number }) {
  assertTalentWritable(input.actor);
  const db = getDb();
  const [document] = await db.select().from(talentApplicationDocuments).where(eq(talentApplicationDocuments.id, input.documentId)).limit(1);
  if (!document || document.deletedAt || document.purgedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  await accessibleTalentApplication(input.actor, document.applicationId);
  if (!["ops", "admin", "vendor"].includes(input.actor.role) && document.uploadedByUserId !== input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the uploader, vendor or Operations can remove this document" });
  await storage.deleteFile({ fileKey: document.objectKey });
  await db.update(talentApplicationDocuments).set({ deletedAt: new Date(), deletedByUserId: input.actor.userId }).where(eq(talentApplicationDocuments.id, document.id));
  await purgeTalentDocumentAnalysis(document.id, input.actor.userId, "document_deleted");
  await appendTalentEvent(document.applicationId, input.actor.userId, "document_deleted", `${document.fileName} removed from object storage`, null, null, { documentId: document.id, financialStateChanged: false });
  return { documentId: document.id, deleted: true };
}

export async function createTalentAssessment(input: { actor: SalesActor; applicationId: number; kind: "geology" | "mathematics" | "aptitude" | "custom"; title: string; questions: { id: string; prompt: string; maxScore: number }[] }) {
  assertSelectionManager(input.actor);
  const { application, campaign } = await accessibleTalentApplication(input.actor, input.applicationId);
  if (!campaignSupportsSelection(campaign.campaignType) || !["submitted", "screening"].includes(application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "Assessments require an early-stage selection application" });
  if (!input.questions.length || new Set(input.questions.map((question) => question.id)).size !== input.questions.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Assessment question IDs must be unique" });
  const maxScore = input.questions.reduce((sum, question) => sum + question.maxScore, 0);
  return getDb().transaction(async (tx) => {
    const [assessment] = await tx.insert(talentAssessments).values({ applicationId: application.id, kind: input.kind, title: input.title, questionsJson: input.questions, maxScore, createdByUserId: input.actor.userId }).returning();
    await tx.update(talentApplications).set({ currentStage: "assessment", version: application.version + 1, updatedAt: new Date() }).where(eq(talentApplications.id, application.id));
    await appendTalentEvent(application.id, input.actor.userId, "assessment_created", `${input.kind} assessment created with ${maxScore} available points`, application.currentStage, "assessment", { assessmentId: assessment.id, automatedDecision: false }, tx);
    return assessment;
  });
}

export async function submitTalentAssessment(input: { actor: SalesActor; assessmentId: number; responses: Record<string, string> }) {
  assertTalentWritable(input.actor);
  const db = getDb();
  const [assessment] = await db.select().from(talentAssessments).where(eq(talentAssessments.id, input.assessmentId)).limit(1);
  if (!assessment || assessment.state !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Pending assessment not found" });
  await accessibleTalentApplication(input.actor, assessment.applicationId);
  const questionIds = assessment.questionsJson.map((question) => question.id);
  if (!assessmentResponsesComplete(questionIds, input.responses)) throw new TRPCError({ code: "BAD_REQUEST", message: "Answer every assessment question before submission" });
  const [updated] = await db.update(talentAssessments).set({ responsesJson: input.responses, state: "submitted", submittedByUserId: input.actor.userId, submittedAt: new Date() }).where(and(eq(talentAssessments.id, assessment.id), eq(talentAssessments.state, "pending"))).returning();
  await appendTalentEvent(assessment.applicationId, input.actor.userId, "assessment_submitted", "Responses submitted for independent human review", "assessment", "assessment", { assessmentId: assessment.id, automatedScore: false });
  return { assessmentId: updated.id, state: updated.state };
}

export async function reviewTalentAssessment(input: { actor: SalesActor; assessmentId: number; score: number; rubricNote: string }) {
  assertSelectionManager(input.actor);
  const db = getDb();
  const [assessment] = await db.select().from(talentAssessments).where(eq(talentAssessments.id, input.assessmentId)).limit(1);
  if (!assessment || assessment.state !== "submitted") throw new TRPCError({ code: "CONFLICT", message: "Submitted assessment not found" });
  const { application } = await accessibleTalentApplication(input.actor, assessment.applicationId);
  if (assessment.submittedByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "The response submitter cannot review their own assessment" });
  if (input.score < 0 || input.score > assessment.maxScore) throw new TRPCError({ code: "BAD_REQUEST", message: `Score must be between 0 and ${assessment.maxScore}` });
  const [updated] = await db.update(talentAssessments).set({ state: "reviewed", score: input.score, rubricNote: input.rubricNote, reviewedByUserId: input.actor.userId, reviewedAt: new Date() }).where(eq(talentAssessments.id, assessment.id)).returning();
  await db.update(talentApplications).set({ score: input.score, version: application.version + 1, updatedAt: new Date() }).where(eq(talentApplications.id, application.id));
  await appendTalentEvent(application.id, input.actor.userId, "assessment_reviewed", input.rubricNote, application.currentStage, application.currentStage, { assessmentId: assessment.id, score: input.score, maxScore: assessment.maxScore, independentReview: true });
  return { assessmentId: updated.id, state: updated.state, score: updated.score, independentlyReviewed: true };
}


export async function scheduleTalentInterview(input: { actor: SalesActor; applicationId: number; scheduledAt: Date; durationMinutes: number; mode: "virtual" | "in_person" | "phone"; location: string; interviewerUserId: number }) {
  assertSelectionManager(input.actor);
  const { application, campaign } = await accessibleTalentApplication(input.actor, input.applicationId);
  if (!campaignSupportsSelection(campaign.campaignType) || !["screening", "assessment"].includes(application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "Interviews require a screened selection application" });
  const assessments = await getDb().select().from(talentAssessments).where(eq(talentAssessments.applicationId, application.id));
  if (assessments.some((assessment) => assessment.state !== "reviewed")) throw new TRPCError({ code: "CONFLICT", message: "All assessments must be independently reviewed before interview scheduling" });
  if (input.actor.role === "vendor" && input.interviewerUserId !== input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Vendor operators can schedule only themselves as interviewers" });
  const db = getDb();
  const [interviewer] = await db.select({ user: users, vendor: vendors }).from(users).leftJoin(vendors, eq(vendors.userId, users.id)).where(eq(users.id, input.interviewerUserId)).limit(1);
  if (!interviewer || !["ops", "admin", "vendor"].includes(interviewer.user.role) || (interviewer.user.role === "vendor" && interviewer.vendor?.id !== campaign.vendorId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Interviewer must be Operations or the campaign vendor" });
  const end = new Date(input.scheduledAt.getTime() + input.durationMinutes * 60_000);
  const existing = await db.select().from(talentInterviews).where(and(eq(talentInterviews.interviewerUserId, input.interviewerUserId), eq(talentInterviews.state, "scheduled")));
  if (existing.some((interview) => input.scheduledAt < new Date(interview.scheduledAt.getTime() + interview.durationMinutes * 60_000) && end > interview.scheduledAt)) throw new TRPCError({ code: "CONFLICT", message: "Interviewer already has an overlapping interview" });
  return db.transaction(async (tx) => {
    const [interview] = await tx.insert(talentInterviews).values({ applicationId: application.id, scheduledAt: input.scheduledAt, durationMinutes: input.durationMinutes, mode: input.mode, location: input.location, interviewerUserId: input.interviewerUserId, createdByUserId: input.actor.userId }).returning();
    await tx.update(talentApplications).set({ currentStage: "interview", version: application.version + 1, updatedAt: new Date() }).where(eq(talentApplications.id, application.id));
    await appendTalentEvent(application.id, input.actor.userId, "interview_scheduled", `${input.mode} interview scheduled; no external calendar invitation was sent`, application.currentStage, "interview", { interviewId: interview.id, externalDelivery: false }, tx);
    return { ...interview, externalInvitationSent: false };
  });
}

export async function scoreTalentInterview(input: { actor: SalesActor; interviewId: number; scorecard: { technical: number; communication: number; teamwork: number }; recommendation: "strong_yes" | "yes" | "no" | "strong_no"; notes: string }) {
  assertSelectionManager(input.actor);
  const db = getDb();
  const [interview] = await db.select().from(talentInterviews).where(eq(talentInterviews.id, input.interviewId)).limit(1);
  if (!interview || interview.state !== "scheduled") throw new TRPCError({ code: "CONFLICT", message: "Scheduled interview not found" });
  const { application } = await accessibleTalentApplication(input.actor, interview.applicationId);
  if (!["ops", "admin"].includes(input.actor.role) && interview.interviewerUserId !== input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the assigned interviewer or Operations can complete this scorecard" });
  const [updated] = await db.update(talentInterviews).set({ state: "completed", scorecardJson: input.scorecard, recommendation: input.recommendation, notes: input.notes, completedByUserId: input.actor.userId, completedAt: new Date() }).where(and(eq(talentInterviews.id, interview.id), eq(talentInterviews.state, "scheduled"))).returning();
  await appendTalentEvent(application.id, input.actor.userId, "interview_completed", input.notes, application.currentStage, application.currentStage, { interviewId: interview.id, recommendation: input.recommendation, scorecard: input.scorecard, automatedDecision: false });
  return { interviewId: updated.id, state: updated.state, recommendation: updated.recommendation };
}

export async function createTalentOffer(input: { actor: SalesActor; applicationId: number; title: string; termsSummary: string; expiresAt: Date }) {
  assertSelectionManager(input.actor);
  const { application } = await accessibleTalentApplication(input.actor, input.applicationId);
  if (application.currentStage !== "offer") throw new TRPCError({ code: "CONFLICT", message: "Move the application to the offer stage before drafting an offer" });
  if (input.expiresAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Offer expiry must be in the future" });
  const existing = await getDb().select({ id: talentOffers.id }).from(talentOffers).where(and(eq(talentOffers.applicationId, application.id), inArray(talentOffers.state, ["draft", "issued"]))).limit(1);
  if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "This application already has an active offer" });
  const [offer] = await getDb().insert(talentOffers).values({ offerRef: talentRef("KF-OFFER").toUpperCase(), applicationId: application.id, title: input.title, termsSummary: input.termsSummary, expiresAt: input.expiresAt, createdByUserId: input.actor.userId }).returning();
  await appendTalentEvent(application.id, input.actor.userId, "offer_drafted", "Offer drafted; it has not been issued or accepted", "offer", "offer", { offerId: offer.id, financialEntitlement: false });
  return offer;
}

export async function issueTalentOffer(input: { actor: SalesActor; offerId: number; expectedVersion: number }) {
  assertSelectionManager(input.actor);
  const db = getDb();
  const [offer] = await db.select().from(talentOffers).where(eq(talentOffers.id, input.offerId)).limit(1);
  if (!offer || offer.state !== "draft") throw new TRPCError({ code: "CONFLICT", message: "Draft offer not found" });
  await accessibleTalentApplication(input.actor, offer.applicationId);
  if (offer.expiresAt <= new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Expired offers cannot be issued" });
  const acceptanceToken = randomBytes(32).toString("base64url");
  const [updated] = await db.update(talentOffers).set({ state: "issued", issuedByUserId: input.actor.userId, issuedAt: new Date(), acceptanceTokenHash: talentHash(acceptanceToken), version: offer.version + 1 }).where(and(eq(talentOffers.id, offer.id), eq(talentOffers.version, input.expectedVersion), eq(talentOffers.state, "draft"))).returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Offer changed elsewhere; refresh before issuing" });
  await appendTalentEvent(offer.applicationId, input.actor.userId, "offer_issued", "Signed response capability issued; raw token was not persisted and no external message was sent", "offer", "offer", { offerId: offer.id, rawTokenPersisted: false, externalDelivery: false });
  return { offerId: updated.id, state: updated.state, version: updated.version, acceptanceToken, tokenPersisted: false, externalDelivery: false };
}

export async function respondToTalentOffer(input: { acceptanceToken: string; decision: "accepted" | "declined" }) {
  const db = getDb();
  const tokenHash = talentHash(input.acceptanceToken);
  const [row] = await db.select({ offer: talentOffers, application: talentApplications, campaign: talentCampaigns }).from(talentOffers)
    .innerJoin(talentApplications, eq(talentOffers.applicationId, talentApplications.id)).innerJoin(talentCampaigns, eq(talentApplications.campaignId, talentCampaigns.id))
    .where(eq(talentOffers.acceptanceTokenHash, tokenHash)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Offer response link is invalid" });
  const responseProblem = signedOfferResponseProblem(row.offer.state, row.offer.expiresAt);
  if (row.offer.state !== "issued") throw new TRPCError({ code: "CONFLICT", message: responseProblem! });
  if (responseProblem) {
    await db.update(talentOffers).set({ state: "expired", version: row.offer.version + 1 }).where(and(eq(talentOffers.id, row.offer.id), eq(talentOffers.state, "issued")));
    throw new TRPCError({ code: "BAD_REQUEST", message: "Offer response link has expired" });
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(talentOffers).set({ state: input.decision, respondedAt: now, responseChannel: "signed_link", version: row.offer.version + 1 }).where(and(eq(talentOffers.id, row.offer.id), eq(talentOffers.state, "issued"), eq(talentOffers.version, row.offer.version))).returning();
    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Offer changed before the response was recorded" });
    const stage: TalentStage = input.decision === "accepted" ? "accepted" : "rejected";
    await tx.update(talentApplications).set({ currentStage: stage, decisionReason: input.decision === "accepted" ? "Signed offer accepted" : "Signed offer declined", version: row.application.version + 1, updatedAt: now }).where(eq(talentApplications.id, row.application.id));
    await appendTalentEvent(row.application.id, null, `offer_${input.decision}`, `Signed offer ${input.decision} through a token-authenticated response`, row.application.currentStage, stage, { offerId: row.offer.id, responseChannel: "signed_link", rawTokenPersisted: false, financialEntitlement: false }, tx);
    return { offerRef: row.offer.offerRef, state: updated.state, applicationStage: stage, respondedAt: now, commissionCreated: false };
  });
}

export async function verifyTalentOutcome(input: { actor: SalesActor; applicationId: number; observedByUserId: number; evidenceNote: string; observedAt: Date }) {
  assertTalentOperations(input.actor);
  if (input.observedByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Outcome review must be independent of the observer" });
  if (input.observedAt > new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Outcome observation cannot be in the future" });
  const { application, campaign } = await accessibleTalentApplication(input.actor, input.applicationId);
  if (application.currentStage !== "accepted") throw new TRPCError({ code: "CONFLICT", message: "Only an accepted candidate or participant can receive a verified outcome" });
  const [observer] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, input.observedByUserId)).limit(1);
  if (!observer) throw new TRPCError({ code: "NOT_FOUND", message: "Outcome observer not found" });
  const outcomeType = campaignOutcomeType(campaign.campaignType);
  return getDb().transaction(async (tx) => {
    const [lockedCampaign] = await tx.select().from(talentCampaigns).where(eq(talentCampaigns.id, campaign.id)).for("update").limit(1);
    const existing = await tx.select({ id: talentOutcomes.id }).from(talentOutcomes).where(and(eq(talentOutcomes.campaignId, campaign.id), eq(talentOutcomes.state, "verified")));
    if (existing.length >= lockedCampaign.targetCount) throw new TRPCError({ code: "CONFLICT", message: "The verified-outcome target is already full" });
    const [outcome] = await tx.insert(talentOutcomes).values({ campaignId: campaign.id, applicationId: application.id, outcomeType, evidenceNote: input.evidenceNote, observedByUserId: input.observedByUserId, reviewedByUserId: input.actor.userId, observedAt: input.observedAt }).onConflictDoNothing().returning();
    if (!outcome) throw new TRPCError({ code: "CONFLICT", message: "This application already has the campaign outcome" });
    await tx.update(talentApplications).set({ currentStage: "completed", completedAt: new Date(), version: application.version + 1, updatedAt: new Date() }).where(eq(talentApplications.id, application.id));
    await appendTalentEvent(application.id, input.actor.userId, "outcome_independently_verified", input.evidenceNote, "accepted", "completed", { outcomeId: outcome.id, outcomeType, independentReview: true, dealCreated: false, commissionCreated: false }, tx);
    return { outcomeId: outcome.id, outcomeType, state: outcome.state, applicationStage: "completed" as const, independentlyReviewed: true, dealCreated: false, commissionCreated: false };
  });
}
