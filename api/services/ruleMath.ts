import { calculateVendorCommissionKobo, splitCommission } from "./money";

export type RuleDraftInput = {
  basis: "flat" | "pct";
  pctBps?: number | null;
  flatAmountKobo?: number | null;
  triggerEvent: "signup" | "kyc_complete" | "funded" | "first_transaction" | "renewal";
  recurrenceMonths: number;
  confirmDays: number;
  clawbackDays: number;
};

export function calculateRuleDryRun(input: RuleDraftInput, sampleAmountKobo: number | null) {
  const normalized = {
    ...input,
    pctBps: input.basis === "pct" ? input.pctBps || null : null,
    flatAmountKobo: input.basis === "flat" ? input.flatAmountKobo || null : null,
  };
  const vendorCommissionKobo = calculateVendorCommissionKobo(normalized, sampleAmountKobo);
  return { ...normalized, sampleAmountKobo, ...splitCommission(vendorCommissionKobo) };
}
