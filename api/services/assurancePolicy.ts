export const MAX_ENROLLMENT_VALIDITY_DAYS = 240;
export const EARLY_REFUND_WINDOW_DAYS = 7;
export const REPEATED_CUSTOMER_THRESHOLD = 3;
export const MAX_BIOMETRIC_EVALUATION_DAYS = 365;

export function enrollmentApprovalValid(input: { state: string; validUntil: Date | null }, now = new Date()) {
  return input.state === "verified" && !!input.validUntil && input.validUntil.getTime() > now.getTime();
}

export function enrollmentValidityWindowValid(submittedAt: Date, validUntil: Date, now = new Date()) {
  const maximum = MAX_ENROLLMENT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  return validUntil.getTime() > now.getTime() && validUntil.getTime() - submittedAt.getTime() <= maximum;
}

export function assuranceSignalBlocks(state: string, severity: string) {
  return ["open", "confirmed"].includes(state) && ["high", "critical"].includes(severity);
}

export function reconcileVendorSample(input: { sampleSize: number; verifiedOutcomes: number; mismatches: number }) {
  const countsValid = Number.isInteger(input.sampleSize) && input.sampleSize > 0
    && Number.isInteger(input.verifiedOutcomes) && input.verifiedOutcomes >= 0
    && Number.isInteger(input.mismatches) && input.mismatches >= 0
    && input.verifiedOutcomes + input.mismatches <= input.sampleSize;
  if (!countsValid) throw new Error("Vendor assurance sample counts are inconsistent");
  return {
    state: input.verifiedOutcomes === input.sampleSize && input.mismatches === 0 ? "passed" as const : "failed" as const,
    unresolved: input.sampleSize - input.verifiedOutcomes - input.mismatches,
  };
}

export function biometricEvaluationValid(input: { state: string; validUntil: Date }, now = new Date()) {
  return input.state === "approved" && input.validUntil.getTime() > now.getTime();
}
