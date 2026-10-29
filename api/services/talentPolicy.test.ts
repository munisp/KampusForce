import { describe, expect, it } from "vitest";
import { assessmentResponsesComplete, directParticipantAcceptanceAllowed, signedOfferResponseProblem, talentCsvCell, talentTargetProblem } from "./talentPolicy";

describe("Phase 18 opportunity campaign policy", () => {
  it("requires complete, unique campus targets that reconcile to the overall target", () => {
    expect(talentTargetProblem([{ campusId: 1, targetCount: 600 }, { campusId: 2, targetCount: 400 }], 1000)).toBeNull();
    expect(talentTargetProblem([{ campusId: 1, targetCount: 1000 }, { campusId: 1, targetCount: 1 }], 1000)).toMatch(/once/);
    expect(talentTargetProblem([{ campusId: 1, targetCount: 999 }], 1000)).toMatch(/add up/);
  });

  it("requires a response for every assessment question and no undeclared responses", () => {
    expect(assessmentResponsesComplete(["q1", "q2"], { q1: "Field model", q2: "Uncertainty analysis" })).toBe(true);
    expect(assessmentResponsesComplete(["q1", "q2"], { q1: "Field model" })).toBe(false);
    expect(assessmentResponsesComplete(["q1"], { q1: "Answer", q2: "Undeclared" })).toBe(false);
    expect(assessmentResponsesComplete(["q1"], { q1: "   " })).toBe(false);
  });

  it("allows only an unexpired issued offer to receive a signed response", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(signedOfferResponseProblem("issued", new Date("2026-10-30T12:00:00Z"), now)).toBeNull();
    expect(signedOfferResponseProblem("draft", new Date("2026-10-30T12:00:00Z"), now)).toMatch(/responded|active/);
    expect(signedOfferResponseProblem("issued", new Date("2026-10-29T12:00:00Z"), now)).toMatch(/expired/);
  });

  it("keeps direct participant acceptance separate from selection-offer acceptance", () => {
    expect(directParticipantAcceptanceAllowed("campus_event", "submitted")).toBe(true);
    expect(directParticipantAcceptanceAllowed("research", "screening")).toBe(true);
    expect(directParticipantAcceptanceAllowed("recruitment", "screening")).toBe(false);
    expect(directParticipantAcceptanceAllowed("scholarship", "assessment")).toBe(false);
    expect(directParticipantAcceptanceAllowed("training", "offer")).toBe(false);
  });

  it("escapes CSV formulas and quotes without changing the underlying application record", () => {
    expect(talentCsvCell("=HYPERLINK(\"https://invalid.example\")")).toBe("\"'=HYPERLINK(\"\"https://invalid.example\"\")\"");
    expect(talentCsvCell("+2348000000000")).toBe("\"'+2348000000000\"");
    expect(talentCsvCell("Geology, Mathematics")).toBe("\"Geology, Mathematics\"");
  });
});
