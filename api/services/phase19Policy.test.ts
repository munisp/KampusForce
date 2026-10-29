import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addRecurrenceMonths, renewalAdmissionProblem } from "./recurrence";
import { calculateRuleDryRun } from "./ruleMath";
import { isInstitutionalCampaign, talentCampaignCatalog } from "./talentAccess";
import { parseTalentDocumentProcessorOutput } from "./talentDocumentProcessor";

const baseRule = { basis: "flat" as const, flatAmountKobo: 100_000, triggerEvent: "renewal" as const, recurrenceMonths: 3, recurrenceIntervalMonths: 2, confirmDays: 30, clawbackDays: 60 };

describe("Phase 19 commercial and institutional policy", () => {
  it("versions adjustable recurrence without changing the canonical 80/20 split", () => {
    const result = calculateRuleDryRun(baseRule, null);
    expect(result).toMatchObject({ recurrenceMonths: 3, recurrenceIntervalMonths: 2, repCommissionKobo: 80_000, platformFeeKobo: 20_000 });
    expect(calculateRuleDryRun({ ...baseRule, triggerEvent: "funded", recurrenceMonths: 12, recurrenceIntervalMonths: 12 }, null)).toMatchObject({ recurrenceMonths: 1, recurrenceIntervalMonths: 1 });
    expect(() => calculateRuleDryRun({ ...baseRule, recurrenceIntervalMonths: 0 }, null)).toThrow(/between 1 and 12/);
  });

  it("handles month ends and admits only due, non-exhausted renewal cycles", () => {
    expect(addRecurrenceMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(addRecurrenceMonths(new Date("2024-01-31T12:00:00Z"), 1).toISOString()).toBe("2024-02-29T12:00:00.000Z");
    const schedule = { state: "awaiting_evidence", cycleNumber: 1, maxCycles: 3, nextDueAt: new Date("2026-10-01T00:00:00Z") } as Parameters<typeof renewalAdmissionProblem>[0];
    expect(renewalAdmissionProblem(schedule, new Date("2026-09-30T00:00:00Z"))).toMatch(/before/);
    expect(renewalAdmissionProblem(schedule, new Date("2026-10-01T00:00:00Z"))).toBeNull();
    expect(renewalAdmissionProblem({ ...schedule, cycleNumber: 3 } as Parameters<typeof renewalAdmissionProblem>[0], new Date("2026-10-02T00:00:00Z"))).toMatch(/limit/);
    expect(renewalAdmissionProblem({ ...schedule, state: "cancelled" } as Parameters<typeof renewalAdmissionProblem>[0], new Date("2026-10-02T00:00:00Z"))).toMatch(/limit/);
  });

  it("keeps all nine institutional journeys distinct from the original eight", () => {
    const institutional = ["grant", "bursary", "public_service", "volunteer", "development_program", "public_health", "innovation_challenge", "emergency_response", "civic_program"];
    expect(talentCampaignCatalog).toHaveLength(17);
    for (const type of institutional) expect(isInstitutionalCampaign(type)).toBe(true);
    for (const type of ["recruitment", "internship", "scholarship", "fellowship", "campus_event", "research", "training", "waitlist"]) expect(isInstitutionalCampaign(type)).toBe(false);
  });
});

describe("Phase 19 bounded document processor contract", () => {
  const envelope = {
    schema_version: "talent-document-v1",
    source_sha256: createHash("sha256").update("synthetic").digest("hex"),
    processor_mode: "external",
    providers: ["paddleocr", "docling", "vlm"],
    provider_versions: { paddleocr: "test-version", docling: "test-version", vlm: "pinned-model" },
    page_count: 1,
    confidence_bps: 9200,
    quality_flags: ["human_review_required"],
    fields: {
      document_kind: "cv", course_names: ["Geology"], institutions: [], qualifications: [], skills: ["Mapping"],
      education_summary: "Bounded synthetic educational evidence.", experience_summary: "", language: "en", quality_flags: [],
    },
    automated_decision: false,
  };

  it("accepts only the complete bounded educational-evidence envelope", () => {
    const parsed = parseTalentDocumentProcessorOutput(JSON.stringify(envelope));
    expect(parsed.providers).toEqual(["paddleocr", "docling", "vlm"]);
    expect(parsed.automatedDecision).toBe(false);
    expect(parsed.fields.page_count).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain("raw_text");
  });

  it("fails closed on missing providers, raw fields or automated decisions", () => {
    expect(() => parseTalentDocumentProcessorOutput(JSON.stringify({ ...envelope, providers: ["paddleocr", "docling"] }))).toThrow(/All three/);
    expect(() => parseTalentDocumentProcessorOutput(JSON.stringify({ ...envelope, fields: { ...envelope.fields, raw_text: "must not persist" } }))).toThrow(/bounded/);
    expect(() => parseTalentDocumentProcessorOutput(JSON.stringify({ ...envelope, automated_decision: true }))).toThrow(/envelope/);
  });
});
