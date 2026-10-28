import { createHash } from "node:crypto";
import { identityReadiness, sanitizeIdentityFindings, validateIdentityEvidenceMetadata } from "./identityPolicy";

type BiometricKind = "capture_integrity" | "liveness" | "face_match" | "deepfake";
type BiometricResult = {
  kind: BiometricKind;
  provider: string;
  state: "passed" | "failed" | "review_required";
  score: number | null;
  threshold: number | null;
  providerReferenceHash: string;
  modelVersion: string | null;
  qualityFlags: string[];
  findings: Record<string, string | number | boolean | null>;
};

function providerConfiguration(kind: "liveness" | "deepfake", env: NodeJS.ProcessEnv) {
  return kind === "liveness"
    ? { url: env.KF_LIVENESS_PROVIDER_URL || "", key: env.KF_LIVENESS_PROVIDER_API_KEY || "", name: env.KF_LIVENESS_PROVIDER_NAME || "liveness-external" }
    : { url: env.KF_DEEPFAKE_PROVIDER_URL || "", key: env.KF_DEEPFAKE_PROVIDER_API_KEY || "", name: env.KF_DEEPFAKE_PROVIDER_NAME || "deepfake-external" };
}

function validateProviderUrl(value: string, env: NodeJS.ProcessEnv) {
  const url = new URL(value);
  const allowedHosts = (env.KF_IDENTITY_PROVIDER_ALLOWED_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.includes(url.hostname)) {
    throw new Error("Identity provider requires HTTPS and an explicitly allowlisted host");
  }
  return url;
}

export async function readBoundedProviderResponse(response: Response, maxBytes = 64 * 1024) {
  if (!response.body) throw new Error("Hosted biometric provider returned an empty response stream");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Hosted biometric provider response exceeded its size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function parseBiometricProviderResults(input: unknown, kind: "liveness" | "deepfake", provider: string, providerReferenceHash: string): BiometricResult[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Biometric provider response must be an object");
  const envelope = input as Record<string, unknown>;
  if (envelope.schema_version !== "identity-biometric-v1" || !Array.isArray(envelope.results)) throw new Error("Biometric provider contract version is invalid");
  const expected: BiometricKind[] = kind === "liveness" ? ["capture_integrity", "liveness", "face_match"] : ["deepfake"];
  if (envelope.results.length !== expected.length) throw new Error("Biometric provider returned an incomplete control set");
  const results = envelope.results.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Biometric result is invalid");
    const item = value as Record<string, unknown>;
    if (item.kind !== expected[index] || !["passed", "failed", "review_required"].includes(String(item.state))) throw new Error("Biometric result kind or state is invalid");
    const score = item.score === null || item.score === undefined ? null : item.score;
    const threshold = item.threshold === null || item.threshold === undefined ? null : item.threshold;
    if (score !== null && typeof score !== "number") throw new Error("Biometric score is invalid");
    if (threshold !== null && typeof threshold !== "number") throw new Error("Biometric threshold is invalid");
    const qualityFlags = item.qualityFlags || [];
    if (!Array.isArray(qualityFlags) || qualityFlags.some((flag) => typeof flag !== "string")) throw new Error("Biometric quality flags are invalid");
    validateIdentityEvidenceMetadata({ score, threshold, providerReferenceHash, qualityFlags });
    if (!item.findings || typeof item.findings !== "object" || Array.isArray(item.findings)) throw new Error("Biometric findings must be a flat object");
    const findings = sanitizeIdentityFindings(item.findings as Record<string, unknown>);
    const requiredSignals: Partial<Record<BiometricKind, string[]>> = {
      capture_integrity: ["capture_attested", "injection_detected"],
      liveness: ["presentation_attack_detected"],
      deepfake: ["tamper_detected"],
    };
    for (const signal of requiredSignals[expected[index]] || []) {
      if (typeof findings[signal] !== "boolean") throw new Error(`Biometric provider must return an explicit ${signal} outcome`);
    }
    let state = item.state as BiometricResult["state"];
    if (findings.injection_detected === true || findings.presentation_attack_detected === true || findings.tamper_detected === true || findings.capture_attested === false) state = "failed";
    return {
      kind: expected[index], provider, state, score, threshold, providerReferenceHash,
      modelVersion: typeof item.modelVersion === "string" ? item.modelVersion.slice(0, 100) : null,
      qualityFlags, findings,
    };
  });
  return results;
}

export async function verifyHostedBiometricSession(input: {
  kind: "liveness" | "deepfake";
  caseRef: string;
  sessionReference: string;
}, env: NodeJS.ProcessEnv = process.env) {
  if (!identityReadiness(env).liveEligible) throw new Error("Hosted biometric verification is disabled until every live identity gate passes");
  if (!input.sessionReference.trim() || input.sessionReference.length > 256) throw new Error("A bounded hosted-provider session reference is required");
  const configuration = providerConfiguration(input.kind, env);
  const url = validateProviderUrl(configuration.url, env);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/verify`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${configuration.key}` },
      body: JSON.stringify({ caseRef: input.caseRef, sessionReference: input.sessionReference }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error("Hosted biometric provider rejected the verification request");
    const text = await readBoundedProviderResponse(response);
    const providerReferenceHash = createHash("sha256").update(`kampusforce:${input.kind}:session:v1:${input.sessionReference}`).digest("hex");
    return parseBiometricProviderResults(JSON.parse(text), input.kind, configuration.name, providerReferenceHash);
  } finally {
    clearTimeout(timeout);
  }
}
