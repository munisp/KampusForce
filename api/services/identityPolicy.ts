import { createHmac } from "node:crypto";
import type { IdentityCase } from "@db/schema";

export const IDENTITY_POLICY_VERSION = "identity-v1";
export const IDENTITY_NOTICE_VERSION = "privacy-notice-v1";
export const IDENTITY_VALIDITY_DAYS = 365;
export const IDENTITY_REVIEW_SLA_HOURS = 24;

export const personCaseTypes = ["representative_kyc", "campus_lead_kyc", "operations_kyc"] as const;
export type IdentityCaseType = IdentityCase["caseType"];
export type IdentityEvidenceKind = "document_ocr" | "document_structure" | "vlm_extraction" | "registry_kyb" | "bank_name_match" | "liveness" | "deepfake" | "face_match" | "capture_integrity" | "reviewer_attestation";

const personEvidence: IdentityEvidenceKind[] = [
  "document_ocr",
  "document_structure",
  "vlm_extraction",
  "capture_integrity",
  "liveness",
  "deepfake",
  "face_match",
];

export const identityTriggerCatalog = [
  { event: "recruitment.invitation_accepted", caseType: "representative_kyc", action: "open_kyc", downstream: "recruitment_activation_blocked_until_approval" },
  { event: "representative.onboarding_submitted", caseType: "representative_kyc", action: "process_documents_and_biometrics", downstream: "manual_review" },
  { event: "campus_lead.promotion_requested", caseType: "campus_lead_kyc", action: "reverify_identity_and_liveness", downstream: "lead_role_unchanged_until_approval" },
  { event: "vendor.activation_requested", caseType: "vendor_kyb", action: "open_kyb_and_signatory_checks", downstream: "vendor_activation_blocked_until_approval" },
  { event: "operations.access_requested", caseType: "operations_kyc", action: "open_reviewer_identity_checks", downstream: "privileged_access_requires_separate_admin_approval" },
  { event: "identity.document_accepted", caseType: "representative_kyc", action: "run_transient_paddleocr_docling_vlm", downstream: "record_bounded_evidence_only" },
  { event: "identity.document_extraction_completed", caseType: "representative_kyc", action: "start_hosted_liveness_capture", downstream: "deepfake_and_capture_integrity_checks" },
  { event: "identity.evidence_completed", caseType: "representative_kyc", action: "route_manual_review", downstream: "approve_request_info_or_reject" },
  { event: "payout.batch_requested", caseType: "representative_kyc", action: "recheck_approval_expiry_and_bank_match", downstream: "hold_or_queue_reverification" },
  { event: "payout.settlement_requested", caseType: "representative_kyc", action: "recheck_current_approval", downstream: "fail_closed_before_provider_call" },
  { event: "identity.risk_signal_received", caseType: "representative_kyc", action: "revoke_or_require_step_up", downstream: "payout_and_activation_recheck" },
  { event: "identity.approval_expiring", caseType: "representative_kyc", action: "request_reverification", downstream: "expire_without_grace" },
  { event: "consent.withdrawn", caseType: "representative_kyc", action: "stop_processing_and_revoke_unneeded_checks", downstream: "publish_privacy_safe_tombstone" },
  { event: "customer.vendor_handoff_requested", caseType: "customer_handoff", action: "redirect_to_vendor_regulated_flow", downstream: "no_platform_kyc_decision_or_biometric_storage" },
] as const;

export function requiredEvidence(caseType: IdentityCaseType): IdentityEvidenceKind[] {
  if (caseType === "vendor_kyb") return [...personEvidence, "registry_kyb"];
  if (caseType === "operations_kyc") return [...personEvidence, "reviewer_attestation"];
  if (caseType === "customer_handoff") return [];
  return [...personEvidence, "bank_name_match"];
}

export function missingIdentityEvidence(caseType: IdentityCaseType, evidence: { kind: string; state: string }[]) {
  const latest = new Map<string, string>();
  for (const item of evidence) latest.set(item.kind, item.state);
  return requiredEvidence(caseType).filter((kind) => latest.get(kind) !== "passed");
}

export function identityApprovalValid(identityCase: Pick<IdentityCase, "state" | "validUntil"> | null | undefined, now = new Date()) {
  return identityCase?.state === "approved" && !!identityCase.validUntil && identityCase.validUntil.getTime() > now.getTime();
}

export function identityReverificationDue(identityCase: Pick<IdentityCase, "state" | "validUntil"> | null | undefined, now = new Date(), withinDays = 30) {
  if (!identityApprovalValid(identityCase, now)) return true;
  return identityCase!.validUntil!.getTime() - now.getTime() <= withinDays * 86_400_000;
}

export function identitySubjectToken(subjectType: string, subjectId: number, secret: string) {
  if (!Number.isInteger(subjectId) || subjectId < 1) throw new Error("A positive subject identifier is required");
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Identity tokenization requires a secret of at least 32 characters");
  return createHmac("sha256", secret).update(`kampusforce:identity:subject:v1:${subjectType}:${subjectId}`).digest("hex");
}

const forbiddenKey = /(^|_)(nin|bvn|raw|document_number|id_number|image|media|selfie|biometric|phone|email|address|account_number|signature|payload)(_|$)/i;
const allowedFindingKeys = new Set([
  "document_type", "country", "expiry_valid", "name_match", "registration_status", "capture_attested",
  "attack_type", "retry_count", "quality_band", "provider_outcome", "review_code", "page_count",
  "extraction_confidence", "tamper_detected", "template_stored", "cross_check_match", "registry_status",
  "signatory_match", "injection_detected", "presentation_attack_detected", "evaluation_reference",
]);

export function sanitizeIdentityFindings(input: Record<string, unknown>) {
  const output: Record<string, string | number | boolean | null> = {};
  const entries = Object.entries(input);
  if (entries.length > 24) throw new Error("Identity evidence exceeds the bounded finding count");
  for (const [key, value] of entries) {
    if (!allowedFindingKeys.has(key) || forbiddenKey.test(key)) throw new Error(`Identity finding is not allowlisted: ${key}`);
    if (value === null || typeof value === "boolean") {
      output[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new Error("Identity finding number is outside its safe bound");
      output[key] = value;
    } else if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized || normalized.length > 80 || /\d{7,}/.test(normalized)) throw new Error("Identity finding text is unsafe or too long");
      output[key] = normalized;
    } else {
      throw new Error("Identity findings must be flat bounded scalar values");
    }
  }
  if (output.template_stored === true) throw new Error("Biometric template persistence is prohibited");
  return output;
}

export function validateIdentityEvidenceMetadata(input: {
  score?: number | null;
  threshold?: number | null;
  providerReferenceHash?: string | null;
  inputSha256?: string | null;
  qualityFlags?: string[];
}) {
  for (const value of [input.score, input.threshold]) {
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error("Identity scores and thresholds must be between zero and one");
    }
  }
  for (const value of [input.providerReferenceHash, input.inputSha256]) {
    if (value && !/^[a-f0-9]{64}$/.test(value)) throw new Error("Provider references and inputs must be stored only as SHA-256 hashes");
  }
  if ((input.qualityFlags?.length || 0) > 12 || input.qualityFlags?.some((flag) => !/^[a-z][a-z0-9_]{0,39}$/.test(flag))) {
    throw new Error("Identity quality flags must be bounded machine-readable codes");
  }
}

function httpsHostname(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" && !url.username && !url.password ? url.hostname : null;
  } catch {
    return null;
  }
}

export function identityReadiness(env: NodeJS.ProcessEnv = process.env) {
  const allowedHosts = (env.KF_IDENTITY_PROVIDER_ALLOWED_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean);
  const vlmHost = httpsHostname(env.KF_VLM_ENDPOINT);
  const livenessHost = httpsHostname(env.KF_LIVENESS_PROVIDER_URL);
  const deepfakeHost = httpsHostname(env.KF_DEEPFAKE_PROVIDER_URL);
  const checks = [
    { key: "document_processor", ready: env.KF_IDENTITY_PROCESSOR_MODE === "external" && !!vlmHost && allowedHosts.includes(vlmHost) && !!(env.KF_VLM_MODEL || "").trim() && (env.KF_VLM_API_KEY || "").length >= 16, detail: "Isolated transient worker with pinned HTTPS VLM, credential and allowlisted host" },
    { key: "liveness_provider", ready: env.KF_LIVENESS_PROVIDER_MODE === "external" && !!livenessHost && allowedHosts.includes(livenessHost) && (env.KF_LIVENESS_PROVIDER_API_KEY || "").length >= 16, detail: "Credentialed hosted capture on an allowlisted HTTPS host with independently evaluated PAD/injection controls" },
    { key: "deepfake_provider", ready: env.KF_DEEPFAKE_PROVIDER_MODE === "external" && !!deepfakeHost && allowedHosts.includes(deepfakeHost) && (env.KF_DEEPFAKE_PROVIDER_API_KEY || "").length >= 16, detail: "Credentialed independent manipulation evaluation on an allowlisted HTTPS host" },
    { key: "provider_evaluation", ready: env.KF_IDENTITY_PROVIDER_EVALUATION_EVIDENCE === "approved", detail: "Security-approved PAD, injection, deepfake and demographic evaluation evidence" },
    { key: "privacy_tokenization", ready: (env.KF_IDENTITY_TOKENIZATION_SECRET || "").length >= 32, detail: "Domain-separated keyed subject pseudonyms" },
    { key: "legal_security_approval", ready: env.KF_IDENTITY_LEGAL_SECURITY_APPROVED === "true", detail: "Approved notices, retention, redress, DPIA and processor contracts" },
    { key: "live_execution", ready: env.KF_ALLOW_LIVE_IDENTITY_EXECUTION === "true", detail: "Explicit live identity execution authorization" },
  ];
  return { checks, liveEligible: checks.every((check) => check.ready), mode: checks.every((check) => check.ready) ? "external" : "sandbox_only" } as const;
}
