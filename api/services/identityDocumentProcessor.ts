import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sanitizeIdentityFindings, validateIdentityEvidenceMetadata } from "./identityPolicy";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_PROCESSOR_OUTPUT_BYTES = 256 * 1024;
const allowedMime = new Map([
  ["application/pdf", "document.pdf"],
  ["image/png", "document.png"],
  ["image/jpeg", "document.jpg"],
]);

export type DocumentEvidenceResult = {
  kind: "document_ocr" | "document_structure" | "vlm_extraction";
  provider: "paddleocr" | "docling" | "vlm";
  state: "passed" | "failed" | "review_required";
  score: number | null;
  threshold: number | null;
  modelVersion: string | null;
  inputSha256: string;
  qualityFlags: string[];
  findings: Record<string, string | number | boolean | null>;
};

export function parseDocumentProcessorOutput(text: string): DocumentEvidenceResult[] {
  if (text.length > MAX_PROCESSOR_OUTPUT_BYTES) throw new Error("Document processor output exceeded its bounded size");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Document processor returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Document processor result must be an object");
  const envelope = parsed as Record<string, unknown>;
  if (envelope.schema_version !== "identity-document-v1" || !Array.isArray(envelope.results) || envelope.results.length !== 3) {
    throw new Error("Document processor must return exactly three versioned evidence results");
  }
  const seen = new Set<string>();
  return envelope.results.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid document evidence result");
    const item = value as Record<string, unknown>;
    const kinds = ["document_ocr", "document_structure", "vlm_extraction"];
    const providers = ["paddleocr", "docling", "vlm"];
    const states = ["passed", "failed", "review_required"];
    if (typeof item.kind !== "string" || !kinds.includes(item.kind) || seen.has(item.kind)) throw new Error("Document evidence kind is missing or duplicated");
    if (typeof item.provider !== "string" || !providers.includes(item.provider)) throw new Error("Document evidence provider is invalid");
    if (typeof item.state !== "string" || !states.includes(item.state)) throw new Error("Document evidence state is invalid");
    if (typeof item.inputSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.inputSha256)) throw new Error("Document input hash is required");
    if (item.modelVersion !== null && (typeof item.modelVersion !== "string" || item.modelVersion.length > 100)) throw new Error("Document model version is invalid");
    if (!Array.isArray(item.qualityFlags) || item.qualityFlags.some((flag) => typeof flag !== "string")) throw new Error("Document quality flags are invalid");
    const score = item.score === null ? null : item.score;
    const threshold = item.threshold === null ? null : item.threshold;
    if (score !== null && typeof score !== "number") throw new Error("Document score is invalid");
    if (threshold !== null && typeof threshold !== "number") throw new Error("Document threshold is invalid");
    validateIdentityEvidenceMetadata({ score, threshold, inputSha256: item.inputSha256, qualityFlags: item.qualityFlags });
    if (!item.findings || typeof item.findings !== "object" || Array.isArray(item.findings)) throw new Error("Document findings must be a flat object");
    seen.add(item.kind);
    return {
      kind: item.kind,
      provider: item.provider,
      state: item.state,
      score,
      threshold,
      modelVersion: item.modelVersion as string | null,
      inputSha256: item.inputSha256,
      qualityFlags: item.qualityFlags,
      findings: sanitizeIdentityFindings(item.findings as Record<string, unknown>),
    } as DocumentEvidenceResult;
  });
}

export async function processIdentityDocumentTransiently(input: { mimeType: string; data: Buffer }) {
  if (process.env.KF_IDENTITY_PROCESSOR_MODE !== "external") throw new Error("External document processing is not configured; synthetic fixtures must use the explicit sandbox workflow");
  const fileName = allowedMime.get(input.mimeType);
  if (!fileName) throw new Error("Only PDF, PNG and JPEG identity documents are supported");
  if (!input.data.length || input.data.length > MAX_DOCUMENT_BYTES) throw new Error("Identity document exceeds the 10 MiB processing limit");
  const directory = await mkdtemp(join(tmpdir(), "kf-identity-"));
  const documentPath = join(directory, fileName);
  try {
    await writeFile(documentPath, input.data, { mode: 0o600, flag: "wx" });
    const worker = resolve(process.cwd(), "identity_platform", "document_worker.py");
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(process.env.KF_IDENTITY_PYTHON || "python3", [worker, "--input", documentPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH || "",
          KF_VLM_ENDPOINT: process.env.KF_VLM_ENDPOINT || "",
          KF_VLM_API_KEY: process.env.KF_VLM_API_KEY || "",
          KF_VLM_MODEL: process.env.KF_VLM_MODEL || "",
        },
      });
      let stdout = "";
      let stderrBytes = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_PROCESSOR_OUTPUT_BYTES) child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; });
      child.on("error", () => { clearTimeout(timer); reject(new Error("Document processor could not be started")); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code !== 0 || signal || stderrBytes > 1024 * 1024) reject(new Error("Document processing failed without persisting the source document"));
        else resolveOutput(stdout);
      });
    });
    return parseDocumentProcessorOutput(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
