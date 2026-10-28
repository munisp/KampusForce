import { describe, expect, it } from "vitest";
import { parseDocumentProcessorOutput } from "./identityDocumentProcessor";
import { parseBiometricProviderResults, readBoundedProviderResponse } from "./identityBiometricProvider";

const hash = "a".repeat(64);
const documentResults = [
  { kind: "document_ocr", provider: "paddleocr", state: "passed", score: 0.95, threshold: 0.75, modelVersion: "pinned-ocr", inputSha256: hash, qualityFlags: [], findings: { extraction_confidence: 0.95 } },
  { kind: "document_structure", provider: "docling", state: "passed", score: null, threshold: null, modelVersion: "pinned-docling", inputSha256: hash, qualityFlags: [], findings: { page_count: 1 } },
  { kind: "vlm_extraction", provider: "vlm", state: "passed", score: null, threshold: null, modelVersion: "pinned-vlm", inputSha256: hash, qualityFlags: ["vlm_cross_check_only"], findings: { cross_check_match: true } },
];

describe("Phase 14 transient processor contracts", () => {
  it("accepts exactly bounded PaddleOCR, Docling and VLM metadata", () => {
    const parsed = parseDocumentProcessorOutput(JSON.stringify({ schema_version: "identity-document-v1", results: documentResults }));
    expect(parsed.map((item) => item.kind)).toEqual(["document_ocr", "document_structure", "vlm_extraction"]);
    expect(JSON.stringify(parsed)).not.toContain("raw_text");
  });

  it("rejects missing controls, duplicate evidence and raw document fields", () => {
    expect(() => parseDocumentProcessorOutput(JSON.stringify({ schema_version: "identity-document-v1", results: documentResults.slice(0, 2) }))).toThrow(/exactly three/);
    expect(() => parseDocumentProcessorOutput(JSON.stringify({ schema_version: "identity-document-v1", results: [documentResults[0], documentResults[0], documentResults[2]] }))).toThrow(/duplicated/);
    const raw = structuredClone(documentResults);
    raw[0].findings = { nin: "12345678901" } as never;
    expect(() => parseDocumentProcessorOutput(JSON.stringify({ schema_version: "identity-document-v1", results: raw }))).toThrow(/allowlisted/);
  });

  it("requires separate capture, liveness, face-match and deepfake outcomes", () => {
    const referenceHash = "b".repeat(64);
    const liveness = parseBiometricProviderResults({ schema_version: "identity-biometric-v1", results: [
      { kind: "capture_integrity", state: "passed", findings: { capture_attested: true, injection_detected: false } },
      { kind: "liveness", state: "passed", score: 0.99, findings: { presentation_attack_detected: false } },
      { kind: "face_match", state: "passed", score: 0.98, findings: { name_match: true } },
    ] }, "liveness", "hosted-liveness", referenceHash);
    expect(liveness.map((item) => item.kind)).toEqual(["capture_integrity", "liveness", "face_match"]);
    const deepfake = parseBiometricProviderResults({ schema_version: "identity-biometric-v1", results: [{ kind: "deepfake", state: "passed", findings: { tamper_detected: false } }] }, "deepfake", "hosted-deepfake", referenceHash);
    expect(deepfake).toHaveLength(1);
  });

  it("fails closed when attack or injection signals contradict a passed provider state", () => {
    const results = parseBiometricProviderResults({ schema_version: "identity-biometric-v1", results: [
      { kind: "capture_integrity", state: "passed", findings: { capture_attested: true, injection_detected: true } },
      { kind: "liveness", state: "passed", findings: { presentation_attack_detected: true } },
      { kind: "face_match", state: "passed", findings: { name_match: true } },
    ] }, "liveness", "hosted-liveness", "b".repeat(64));
    expect(results[0].state).toBe("failed");
    expect(results[1].state).toBe("failed");
    expect(() => parseBiometricProviderResults({ schema_version: "identity-biometric-v1", results: [
      { kind: "capture_integrity", state: "passed", findings: { capture_attested: true } },
      { kind: "liveness", state: "passed", findings: { presentation_attack_detected: false } },
      { kind: "face_match", state: "passed", findings: { name_match: true } },
    ] }, "liveness", "hosted-liveness", "b".repeat(64))).toThrow(/explicit injection_detected/);
    expect(() => parseBiometricProviderResults({ schema_version: "identity-biometric-v1", results: [{ kind: "deepfake", state: "passed", findings: {} }] }, "deepfake", "hosted-deepfake", "b".repeat(64))).toThrow(/explicit tamper_detected/);
    expect(() => parseBiometricProviderResults({ schema_version: "identity-biometric-v1", results: [{ kind: "deepfake", state: "passed", findings: { tamper_detected: false, template_stored: true } }] }, "deepfake", "hosted-deepfake", "b".repeat(64))).toThrow(/prohibited/);
  });

  it("bounds provider responses while streaming and rejects malformed UTF-8", async () => {
    await expect(readBoundedProviderResponse(new Response('{"status":"ok"}'), 32)).resolves.toBe('{"status":"ok"}');
    await expect(readBoundedProviderResponse(new Response("x".repeat(65)), 64)).rejects.toThrow(/size limit/);
    await expect(readBoundedProviderResponse(new Response(new Uint8Array([0xff])))).rejects.toThrow();
  });
});
