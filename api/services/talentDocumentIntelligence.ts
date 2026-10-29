import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  talentApplicationDocuments,
  talentDocumentAnalyses,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { storage } from "../lib/storage";
import { accessibleTalentApplication, appendTalentEvent, assertTalentOperations, assertTalentWritable } from "./talentAccess";
import { assertSalesRole, type SalesActor } from "./salesAccess";
import { processTalentDocumentTransiently } from "./talentDocumentProcessor";

function clean(value: string, maximum = 2000) {
  return value.trim().slice(0, maximum);
}

async function analysisContext(actor: SalesActor, documentId: number) {
  assertTalentWritable(actor);
  const db = getDb();
  const [document] = await db.select().from(talentApplicationDocuments).where(eq(talentApplicationDocuments.id, documentId)).limit(1);
  if (!document || document.deletedAt || document.purgedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Active applicant document not found" });
  const context = await accessibleTalentApplication(actor, document.applicationId);
  if (context.applicant.consentWithdrawnAt || context.applicant.anonymizedAt) throw new TRPCError({ code: "CONFLICT", message: "Applicant consent is no longer active" });
  if (["rejected", "withdrawn"].includes(context.application.currentStage)) throw new TRPCError({ code: "CONFLICT", message: "A closed application cannot be analysed" });
  return { document, ...context };
}

export async function analyzeTalentDocument(input: {
  actor: SalesActor;
  documentId: number;
  consentVersion: string;
  consentedAt: Date;
  retentionUntil: Date;
}) {
  const { document, application, applicant } = await analysisContext(input.actor, input.documentId);
  const consentVersion = clean(input.consentVersion, 100);
  const now = new Date();
  if (consentVersion.length < 3 || input.consentedAt > now || input.consentedAt < applicant.consentedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Explicit document-analysis consent must be versioned and cannot predate applicant consent" });
  if (input.retentionUntil <= now || input.retentionUntil > applicant.retentionUntil) throw new TRPCError({ code: "BAD_REQUEST", message: "Analysis retention must be in the future and cannot exceed applicant retention" });
  if (document.size > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Document analysis is limited to 10 MiB; the stored original remains available for manual review" });
  const db = getDb();
  const [existing] = await db.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.documentId, document.id)).for("update").limit(1);
  if (existing && !["failed", "withdrawn", "purged"].includes(existing.state)) throw new TRPCError({ code: "CONFLICT", message: "This document already has an active or reviewed analysis" });
  const values = {
    applicationId: application.id,
    consentVersion,
    consentedAt: input.consentedAt,
    retentionUntil: input.retentionUntil,
    state: "processing",
    processorMode: "pending",
    providersJson: [] as string[],
    extractedFieldsJson: {} as Record<string, unknown>,
    confidenceBps: null,
    qualityFlagsJson: [] as string[],
    providerVersionsJson: {} as Record<string, string>,
    sourceSha256: document.sha256,
    rawTextPersisted: false,
    automatedDecision: false,
    errorCode: null,
    requestedByUserId: input.actor.userId,
    processedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    withdrawnAt: null,
    purgedAt: null,
    updatedAt: now,
  };
  const [analysis] = existing
    ? await db.update(talentDocumentAnalyses).set(values).where(eq(talentDocumentAnalyses.id, existing.id)).returning()
    : await db.insert(talentDocumentAnalyses).values({ documentId: document.id, ...values }).returning();
  try {
    const bytes = await storage.readFile({ fileKey: document.objectKey });
    const data = Buffer.from(bytes);
    if (createHash("sha256").update(data).digest("hex") !== document.sha256) throw new Error("Stored document hash does not match the uploaded evidence");
    if (process.env.KF_TALENT_PROCESSOR_MODE === "fixture") {
      const [fixture] = await db.update(talentDocumentAnalyses).set({
        state: "needs_review",
        processorMode: "sandbox_fixture",
        providersJson: ["metadata_only"],
        extractedFieldsJson: { document_kind: document.documentType, page_count: null },
        qualityFlagsJson: ["metadata_only_no_ocr", "human_review_required"],
        processedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(talentDocumentAnalyses.id, analysis.id)).returning();
      await appendTalentEvent(application.id, input.actor.userId, "document_analysis_metadata_ready", "Sandbox metadata prepared; no OCR, Docling or VLM extraction was performed", application.currentStage, application.currentStage, { analysisId: fixture.id, automatedDecision: false }, db);
      return { analysisId: fixture.id, state: fixture.state, processorMode: fixture.processorMode, humanReviewRequired: true, automatedDecision: false };
    }
    const extracted = await processTalentDocumentTransiently({ mimeType: document.contentType, data });
    if (extracted.sourceSha256 !== document.sha256) throw new Error("Processor source hash does not match the stored document");
    const [completed] = await db.update(talentDocumentAnalyses).set({
      state: "needs_review",
      processorMode: extracted.processorMode,
      providersJson: extracted.providers,
      extractedFieldsJson: extracted.fields,
      confidenceBps: extracted.confidenceBps,
      qualityFlagsJson: [...new Set([...extracted.qualityFlags, "human_review_required"])].slice(0, 30),
      providerVersionsJson: extracted.providerVersions,
      processedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(talentDocumentAnalyses.id, analysis.id)).returning();
    await appendTalentEvent(application.id, input.actor.userId, "document_analysis_ready", "Bounded OCR, Docling and VLM evidence is ready for independent human review", application.currentStage, application.currentStage, { analysisId: completed.id, providers: completed.providersJson, rawTextPersisted: false, automatedDecision: false }, db);
    return { analysisId: completed.id, state: completed.state, processorMode: completed.processorMode, humanReviewRequired: true, automatedDecision: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document analysis failed";
    const errorCode = message.includes("not configured") ? "PROCESSOR_NOT_CONFIGURED" : message.includes("supports") ? "UNSUPPORTED_ANALYSIS_FORMAT" : "DOCUMENT_PROCESSING_FAILED";
    await db.update(talentDocumentAnalyses).set({ state: "failed", processorMode: "unavailable", errorCode, qualityFlagsJson: ["human_review_required"], processedAt: new Date(), updatedAt: new Date() }).where(eq(talentDocumentAnalyses.id, analysis.id));
    throw new TRPCError({ code: "BAD_REQUEST", message: `${message}. No extracted text or automated candidate decision was saved.` });
  }
}

export async function reviewTalentDocumentAnalysis(input: { actor: SalesActor; analysisId: number; decision: "approved" | "rejected"; note: string }) {
  assertSalesRole(input.actor, ["vendor", "ops", "admin"]);
  const note = clean(input.note);
  if (note.length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "A human-review note is required" });
  const db = getDb();
  return db.transaction(async (tx) => {
    const [analysis] = await tx.select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, input.analysisId)).for("update").limit(1);
    if (!analysis || analysis.state !== "needs_review") throw new TRPCError({ code: "CONFLICT", message: "Document analysis is not awaiting human review" });
    if (analysis.requestedByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent human review is required" });
    await accessibleTalentApplication(input.actor, analysis.applicationId);
    const [updated] = await tx.update(talentDocumentAnalyses).set({ state: input.decision, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: note, automatedDecision: false, updatedAt: new Date() }).where(eq(talentDocumentAnalyses.id, analysis.id)).returning();
    await appendTalentEvent(analysis.applicationId, input.actor.userId, `document_analysis_${input.decision}`, "Human reviewer assessed bounded document evidence; application stage and score were not automatically changed", null, null, { analysisId: analysis.id, automatedDecision: false, financialStateChanged: false }, tx);
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: `talent_document_analysis.${input.decision}`, entityType: "talent_document_analysis", entityId: String(analysis.id), metadataJson: { independentHumanReview: true, automatedDecision: false, financialStateChanged: false } });
    return { analysisId: analysis.id, state: updated.state, independentlyReviewed: true, automatedDecision: false, commissionCreated: false };
  });
}

export async function purgeTalentDocumentAnalysis(documentId: number, actorUserId: number, reason: "document_deleted" | "retention_expired") {
  const now = new Date();
  const [updated] = await getDb().update(talentDocumentAnalyses).set({ state: "purged", extractedFieldsJson: {}, providersJson: [], providerVersionsJson: {}, qualityFlagsJson: [reason], confidenceBps: null, purgedAt: now, updatedAt: now }).where(and(eq(talentDocumentAnalyses.documentId, documentId), isNull(talentDocumentAnalyses.purgedAt))).returning({ id: talentDocumentAnalyses.id, applicationId: talentDocumentAnalyses.applicationId });
  if (updated) await appendTalentEvent(updated.applicationId, actorUserId, "document_analysis_purged", `Bounded analysis fields purged after ${reason.replace("_", " ")}`, null, null, { analysisId: updated.id, financialStateChanged: false });
  return { purged: !!updated };
}

export async function listTalentDocumentAnalysis(actor: SalesActor, analysisId: number) {
  const [analysis] = await getDb().select().from(talentDocumentAnalyses).where(eq(talentDocumentAnalyses.id, analysisId)).limit(1);
  if (!analysis) throw new TRPCError({ code: "NOT_FOUND", message: "Document analysis not found" });
  await accessibleTalentApplication(actor, analysis.applicationId);
  if (actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance cannot access applicant document analysis" });
  return analysis;
}

export async function withdrawTalentDocumentAnalysis(actor: SalesActor, analysisId: number) {
  assertTalentWritable(actor);
  const analysis = await listTalentDocumentAnalysis(actor, analysisId);
  if (analysis.purgedAt) return { analysisId, state: "purged" as const };
  const [updated] = await getDb().update(talentDocumentAnalyses).set({ state: "withdrawn", extractedFieldsJson: {}, providersJson: [], providerVersionsJson: {}, confidenceBps: null, qualityFlagsJson: ["analysis_consent_withdrawn"], withdrawnAt: new Date(), purgedAt: new Date(), updatedAt: new Date() }).where(eq(talentDocumentAnalyses.id, analysisId)).returning();
  return { analysisId, state: updated.state, rawTextPersisted: false };
}

export async function assertDocumentAnalysisOperations(actor: SalesActor) {
  assertTalentOperations(actor);
}
