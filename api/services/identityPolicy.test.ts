import { describe, expect, it } from "vitest";
import {
  identityApprovalValid,
  identityReadiness,
  identityReverificationDue,
  identitySubjectToken,
  identityTriggerCatalog,
  missingIdentityEvidence,
  requiredEvidence,
  sanitizeIdentityFindings,
  validateIdentityEvidenceMetadata,
} from "./identityPolicy";

describe("Phase 14 identity policy", () => {
  it("requires document, capture, liveness, deepfake, face and payout controls independently", () => {
    expect(requiredEvidence("representative_kyc")).toEqual(expect.arrayContaining(["document_ocr", "document_structure", "vlm_extraction", "capture_integrity", "liveness", "deepfake", "face_match", "bank_name_match"]));
    expect(requiredEvidence("vendor_kyb")).toContain("registry_kyb");
    expect(requiredEvidence("operations_kyc")).toContain("reviewer_attestation");
    expect(requiredEvidence("customer_handoff")).toEqual([]);
    expect(missingIdentityEvidence("representative_kyc", [{ kind: "liveness", state: "passed" }])).toContain("deepfake");
  });

  it("expires approvals and marks reverification without treating case state as permanent", () => {
    const future = new Date(Date.now() + 10 * 86_400_000);
    expect(identityApprovalValid({ state: "approved", validUntil: future })).toBe(true);
    expect(identityReverificationDue({ state: "approved", validUntil: future })).toBe(true);
    expect(identityApprovalValid({ state: "approved", validUntil: new Date(Date.now() - 1) })).toBe(false);
    expect(identityApprovalValid({ state: "revoked", validUntil: future })).toBe(false);
  });

  it("uses domain-separated keyed subject tokens", () => {
    const secret = "synthetic-identity-tokenization-secret-32chars";
    expect(identitySubjectToken("user", 1, secret)).toMatch(/^[a-f0-9]{64}$/);
    expect(identitySubjectToken("user", 1, secret)).not.toBe(identitySubjectToken("vendor", 1, secret));
    expect(identitySubjectToken("user", 1, secret)).not.toBe(identitySubjectToken("user", 1, `${secret}-other`));
    expect(() => identitySubjectToken("user", 1, "short")).toThrow(/32 characters/);
  });

  it("rejects raw identifiers, nested payloads and biometric-template persistence", () => {
    expect(sanitizeIdentityFindings({ provider_outcome: "passed", template_stored: false })).toEqual({ provider_outcome: "passed", template_stored: false });
    expect(() => sanitizeIdentityFindings({ nin: "12345678901" })).toThrow(/allowlisted/);
    expect(() => sanitizeIdentityFindings({ provider_outcome: { raw: "value" } })).toThrow(/flat bounded/);
    expect(() => sanitizeIdentityFindings({ template_stored: true })).toThrow(/prohibited/);
    expect(() => sanitizeIdentityFindings({ evaluation_reference: "12345678901" })).toThrow(/unsafe/);
  });

  it("bounds scores, hashes and quality codes", () => {
    expect(() => validateIdentityEvidenceMetadata({ score: 1.2 })).toThrow(/between zero and one/);
    expect(() => validateIdentityEvidenceMetadata({ inputSha256: "raw-document" })).toThrow(/SHA-256/);
    expect(() => validateIdentityEvidenceMetadata({ qualityFlags: ["contains spaces"] })).toThrow(/machine-readable/);
  });

  it("fails live readiness closed and includes event-driven payout and onboarding triggers", () => {
    expect(identityReadiness({}).liveEligible).toBe(false);
    expect(identityTriggerCatalog.some((trigger) => trigger.event === "recruitment.invitation_accepted")).toBe(true);
    expect(identityTriggerCatalog.some((trigger) => trigger.event === "payout.settlement_requested")).toBe(true);
    expect(identityTriggerCatalog.some((trigger) => trigger.event === "consent.withdrawn")).toBe(true);
  });

  it("requires credentials and allowlisted HTTPS hosts without treating configuration as provider verification", () => {
    const configured: NodeJS.ProcessEnv = {
      KF_IDENTITY_PROCESSOR_MODE: "external",
      KF_VLM_ENDPOINT: "https://documents.example.com/v1/chat",
      KF_VLM_MODEL: "pinned-vlm-v1",
      KF_VLM_API_KEY: "synthetic-vlm-key-123456",
      KF_LIVENESS_PROVIDER_MODE: "external",
      KF_LIVENESS_PROVIDER_URL: "https://liveness.example.com/sessions",
      KF_LIVENESS_PROVIDER_API_KEY: "synthetic-liveness-key-123456",
      KF_DEEPFAKE_PROVIDER_MODE: "external",
      KF_DEEPFAKE_PROVIDER_URL: "https://deepfake.example.com/sessions",
      KF_DEEPFAKE_PROVIDER_API_KEY: "synthetic-deepfake-key-123456",
      KF_IDENTITY_PROVIDER_ALLOWED_HOSTS: "documents.example.com,liveness.example.com,deepfake.example.com",
      KF_IDENTITY_PROVIDER_EVALUATION_EVIDENCE: "approved",
      KF_IDENTITY_TOKENIZATION_SECRET: "synthetic-identity-tokenization-secret-32chars",
      KF_IDENTITY_LEGAL_SECURITY_APPROVED: "true",
      KF_ALLOW_LIVE_IDENTITY_EXECUTION: "true",
    };
    expect(identityReadiness(configured).liveEligible).toBe(true);
    expect(identityReadiness({ ...configured, KF_DEEPFAKE_PROVIDER_API_KEY: "" }).liveEligible).toBe(false);
    expect(identityReadiness({ ...configured, KF_LIVENESS_PROVIDER_URL: "https://unlisted.example.com/sessions" }).liveEligible).toBe(false);
  });
});
