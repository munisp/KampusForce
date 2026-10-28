import { describe, expect, it } from "vitest";
import {
  assuranceSignalBlocks,
  biometricEvaluationValid,
  enrollmentApprovalValid,
  enrollmentValidityWindowValid,
  reconcileVendorSample,
} from "./assurancePolicy";

const now = new Date("2026-10-29T12:00:00.000Z");

describe("student assurance policy", () => {
  it("requires verified enrollment with a future validity date", () => {
    expect(enrollmentApprovalValid({ state: "verified", validUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(enrollmentApprovalValid({ state: "submitted", validUntil: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(enrollmentApprovalValid({ state: "verified", validUntil: now }, now)).toBe(false);
    expect(enrollmentApprovalValid({ state: "verified", validUntil: null }, now)).toBe(false);
  });

  it("accepts a future enrollment window bounded to 240 days", () => {
    const submittedAt = new Date(now.getTime() - 86400000);
    expect(enrollmentValidityWindowValid(submittedAt, new Date(submittedAt.getTime() + 240 * 86400000), now)).toBe(true);
    expect(enrollmentValidityWindowValid(submittedAt, new Date(submittedAt.getTime() + 240 * 86400000 + 1), now)).toBe(false);
    expect(enrollmentValidityWindowValid(submittedAt, now, now)).toBe(false);
  });

  it("blocks only unresolved high or critical quality signals", () => {
    expect(assuranceSignalBlocks("open", "high")).toBe(true);
    expect(assuranceSignalBlocks("confirmed", "critical")).toBe(true);
    expect(assuranceSignalBlocks("open", "warning")).toBe(false);
    expect(assuranceSignalBlocks("cleared", "critical")).toBe(false);
    expect(assuranceSignalBlocks("rejected", "high")).toBe(false);
  });

  it("passes only a completely reconciled vendor sample", () => {
    expect(reconcileVendorSample({ sampleSize: 10, verifiedOutcomes: 10, mismatches: 0 })).toEqual({ state: "passed", unresolved: 0 });
    expect(reconcileVendorSample({ sampleSize: 10, verifiedOutcomes: 9, mismatches: 1 })).toEqual({ state: "failed", unresolved: 0 });
    expect(reconcileVendorSample({ sampleSize: 10, verifiedOutcomes: 8, mismatches: 1 })).toEqual({ state: "failed", unresolved: 1 });
  });

  it("rejects inconsistent vendor sample counts", () => {
    expect(() => reconcileVendorSample({ sampleSize: 2, verifiedOutcomes: 2, mismatches: 1 })).toThrow("inconsistent");
    expect(() => reconcileVendorSample({ sampleSize: 0, verifiedOutcomes: 0, mismatches: 0 })).toThrow("inconsistent");
    expect(() => reconcileVendorSample({ sampleSize: 2.5, verifiedOutcomes: 2, mismatches: 0 })).toThrow("inconsistent");
    expect(() => reconcileVendorSample({ sampleSize: 2, verifiedOutcomes: -1, mismatches: 0 })).toThrow("inconsistent");
  });

  it("requires approved, unexpired biometric evaluation evidence", () => {
    expect(biometricEvaluationValid({ state: "approved", validUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(biometricEvaluationValid({ state: "rejected", validUntil: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(biometricEvaluationValid({ state: "expired", validUntil: new Date(now.getTime() + 1) }, now)).toBe(false);
    expect(biometricEvaluationValid({ state: "approved", validUntil: now }, now)).toBe(false);
  });
});
