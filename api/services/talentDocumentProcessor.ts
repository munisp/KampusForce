import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_PROCESSOR_OUTPUT_BYTES = 128 * 1024;
const allowedMime = new Map([
  ["application/pdf", "document.pdf"],
  ["image/png", "document.png"],
  ["image/jpeg", "document.jpg"],
  ["image/webp", "document.webp"],
]);

export type TalentDocumentExtraction = {
  sourceSha256: string;
  processorMode: "external";
  providers: ["paddleocr", "docling", "vlm"];
  providerVersions: Record<string, string>;
  pageCount: number | null;
  confidenceBps: number | null;
  qualityFlags: string[];
  fields: Record<string, unknown>;
  automatedDecision: false;
};

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum) throw new Error("Document processor returned an invalid bounded string");
  return value;
}

function boundedList(value: unknown, maximumItems: number) {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error("Document processor returned an oversized list");
  return value.map((item) => boundedString(item, 120));
}

export function parseTalentDocumentProcessorOutput(text: string): TalentDocumentExtraction {
  if (text.length > MAX_PROCESSOR_OUTPUT_BYTES) throw new Error("Document processor output exceeded its bounded size");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Document processor returned invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Document processor result must be an object");
  const result = value as Record<string, unknown>;
  if (result.schema_version !== "talent-document-v1" || result.processor_mode !== "external" || result.automated_decision !== false) throw new Error("Document processor envelope is invalid");
  if (typeof result.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.source_sha256)) throw new Error("Document source hash is invalid");
  if (JSON.stringify(result.providers) !== JSON.stringify(["paddleocr", "docling", "vlm"])) throw new Error("All three document providers are required");
  if (!result.fields || typeof result.fields !== "object" || Array.isArray(result.fields)) throw new Error("Document fields must be an object");
  const fields = result.fields as Record<string, unknown>;
  const allowed = ["document_kind", "course_names", "institutions", "qualifications", "skills", "education_summary", "experience_summary", "language", "quality_flags"];
  if (Object.keys(fields).sort().join(",") !== [...allowed].sort().join(",")) throw new Error("Document fields exceed the bounded ATS contract");
  if (typeof fields.document_kind !== "string" || !["cv", "transcript", "certificate", "course_document", "other"].includes(fields.document_kind)) throw new Error("Document kind is invalid");
  const cleanFields = {
    document_kind: fields.document_kind,
    course_names: boundedList(fields.course_names, 20),
    institutions: boundedList(fields.institutions, 10),
    qualifications: boundedList(fields.qualifications, 10),
    skills: boundedList(fields.skills, 30),
    education_summary: boundedString(fields.education_summary, 500),
    experience_summary: boundedString(fields.experience_summary, 500),
    language: boundedString(fields.language, 40),
    quality_flags: boundedList(fields.quality_flags, 10),
  };
  if (result.confidence_bps !== null && (!Number.isInteger(result.confidence_bps) || (result.confidence_bps as number) < 0 || (result.confidence_bps as number) > 10_000)) throw new Error("Document confidence is invalid");
  if (result.page_count !== null && (!Number.isInteger(result.page_count) || (result.page_count as number) < 0 || (result.page_count as number) > 10_000)) throw new Error("Document page count is invalid");
  if (!result.provider_versions || typeof result.provider_versions !== "object" || Array.isArray(result.provider_versions)) throw new Error("Provider versions are required");
  const providerVersions = Object.fromEntries(Object.entries(result.provider_versions as Record<string, unknown>).map(([key, item]) => [key.slice(0, 40), boundedString(item, 100)]));
  return {
    sourceSha256: result.source_sha256,
    processorMode: "external",
    providers: ["paddleocr", "docling", "vlm"],
    providerVersions,
    pageCount: result.page_count as number | null,
    confidenceBps: result.confidence_bps as number | null,
    qualityFlags: boundedList(result.quality_flags, 30),
    fields: { ...cleanFields, page_count: result.page_count },
    automatedDecision: false,
  };
}

export async function processTalentDocumentTransiently(input: { mimeType: string; data: Buffer }) {
  if (process.env.KF_TALENT_PROCESSOR_MODE !== "external") throw new Error("External ATS document processing is not configured");
  const fileName = allowedMime.get(input.mimeType);
  if (!fileName) throw new Error("ATS analysis supports PDF, PNG, JPEG and WebP source documents");
  if (!input.data.length || input.data.length > MAX_DOCUMENT_BYTES) throw new Error("ATS document exceeds the 10 MiB processing limit");
  const directory = await mkdtemp(join(tmpdir(), "kf-talent-document-"));
  const documentPath = join(directory, fileName);
  try {
    await writeFile(documentPath, input.data, { mode: 0o600, flag: "wx" });
    const worker = resolve(process.cwd(), "identity_platform", "talent_document_worker.py");
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(process.env.KF_TALENT_PYTHON || "python3", [worker, "--input", documentPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH || "",
          PYTHONPATH: process.env.KF_TALENT_PYTHONPATH || "",
          PADDLEOCR_DEVICE: process.env.PADDLEOCR_DEVICE || "cpu",
          PADDLEOCR_ENABLE_MKLDNN: process.env.PADDLEOCR_ENABLE_MKLDNN || "false",
          KF_VLM_ENDPOINT: process.env.KF_VLM_ENDPOINT || "",
          KF_VLM_API_KEY: process.env.KF_VLM_API_KEY || "",
          KF_VLM_MODEL: process.env.KF_VLM_MODEL || "",
        },
      });
      let stdout = "";
      let stderrBytes = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_PROCESSOR_OUTPUT_BYTES) child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; });
      child.on("error", () => { clearTimeout(timer); reject(new Error("ATS document processor could not be started")); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code !== 0 || signal || stderrBytes > 1024 * 1024) reject(new Error("ATS document processing failed; no source text was persisted"));
        else resolveOutput(stdout);
      });
    });
    return parseTalentDocumentProcessorOutput(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
