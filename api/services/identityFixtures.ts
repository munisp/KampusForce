import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { identityCases, type IdentityCase } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  ensureIdentityCase,
  recordIdentityConsent,
  recordIdentityEvidence,
  reviewIdentityCase,
  routeIdentityCaseToReview,
  submitIdentityCase,
} from "./identity";
import { identityApprovalValid, requiredEvidence } from "./identityPolicy";

const providers = {
  document_ocr: "paddleocr-synthetic",
  document_structure: "docling-synthetic",
  vlm_extraction: "vlm-synthetic",
  registry_kyb: "registry-synthetic",
  bank_name_match: "bank-match-synthetic",
  capture_integrity: "capture-synthetic",
  liveness: "liveness-synthetic",
  deepfake: "deepfake-synthetic",
  face_match: "face-match-synthetic",
  reviewer_attestation: "reviewer-synthetic",
} as const;

export async function processSyntheticIdentityCase(caseId: number, actorUserId: number) {
  const [identityCase] = await getDb().select().from(identityCases).where(eq(identityCases.id, caseId)).limit(1);
  if (!identityCase) throw new TRPCError({ code: "NOT_FOUND", message: "Identity case not found" });
  if (identityCase.providerMode !== "sandbox") throw new TRPCError({ code: "FORBIDDEN", message: "Synthetic evidence is prohibited for live identity cases" });
  if (!["submitted", "processing", "needs_more_info"].includes(identityCase.state)) throw new TRPCError({ code: "CONFLICT", message: "Submit the case before running synthetic processing" });
  for (const kind of requiredEvidence(identityCase.caseType)) {
    await recordIdentityEvidence({
      caseId,
      actorUserId,
      kind,
      provider: providers[kind],
      state: "passed",
      score: 0.99,
      threshold: 0.9,
      inputSha256: `${String(caseId).padStart(8, "0")}${"0".repeat(56)}`.slice(0, 64),
      modelVersion: "synthetic-control-fixture-v1",
      qualityFlags: ["synthetic_only"],
      findings: { provider_outcome: "passed", template_stored: false, review_code: kind },
    });
  }
  const updated = await routeIdentityCaseToReview(caseId, actorUserId);
  return { caseRef: updated.caseRef, state: updated.state, synthetic: true, providerEvaluationImplied: false };
}

export async function completeSyntheticIdentityWorkflow(input: {
  caseType: IdentityCase["caseType"];
  subjectType: "user" | "vendor";
  subjectId: number;
  requestUserId: number;
  reviewerUserId: number;
  campusId?: number | null;
  vendorId?: number | null;
  triggerEvent?: string;
}) {
  const opened = await ensureIdentityCase({
    caseType: input.caseType,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    requestedByUserId: input.requestUserId,
    campusId: input.campusId,
    vendorId: input.vendorId,
    triggerEvent: input.triggerEvent || "sandbox.identity_fixture_requested",
  });
  let identityCase = opened.identityCase;
  if (identityApprovalValid(identityCase)) return { identityCase, synthetic: true, alreadyApproved: true };
  for (const purpose of ["identity_verification", "biometric_liveness"] as const) {
    await recordIdentityConsent({ caseId: identityCase.id, actorUserId: input.requestUserId, purpose });
  }
  if (["draft", "needs_more_info"].includes(identityCase.state)) identityCase = await submitIdentityCase(identityCase.id, input.requestUserId);
  if (["submitted", "processing"].includes(identityCase.state)) await processSyntheticIdentityCase(identityCase.id, input.reviewerUserId);
  const reviewed = await reviewIdentityCase({
    caseId: identityCase.id,
    actorUserId: input.reviewerUserId,
    decision: "approve",
    reason: "Synthetic sandbox control fixture approved for workflow acceptance; no external identity assurance is implied.",
  });
  return { identityCase: reviewed.identityCase, synthetic: true, alreadyApproved: false };
}
