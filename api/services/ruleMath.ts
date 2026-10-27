import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { DEFAULT_ACTIVATION_CAP_PER_REP_DAY } from "./fraudPolicy";

export type RuleDraftInput = {
  basis: "flat" | "pct";
  pctBps?: number | null;
  flatAmountKobo?: number | null;
  triggerEvent: "signup" | "kyc_complete" | "funded" | "first_transaction" | "renewal";
  recurrenceMonths: number;
  confirmDays: number;
  clawbackDays: number;
  activationCapPerRepDay?: number;
};

export function calculateRuleDryRun(input: RuleDraftInput, sampleAmountKobo: number | null) {
  const normalized = {
    ...input,
    pctBps: input.basis === "pct" ? input.pctBps || null : null,
    flatAmountKobo: input.basis === "flat" ? input.flatAmountKobo || null : null,
    activationCapPerRepDay: input.activationCapPerRepDay ?? DEFAULT_ACTIVATION_CAP_PER_REP_DAY,
  };
  const vendorCommissionKobo = calculateVendorCommissionKobo(normalized, sampleAmountKobo);
  return { ...normalized, sampleAmountKobo, ...splitCommission(vendorCommissionKobo) };
}
