import { calculateVendorCommissionKobo, splitCommission } from "./money";
import { DEFAULT_ACTIVATION_CAP_PER_REP_DAY } from "./fraudPolicy";

export type RuleDraftInput = {
  basis: "flat" | "pct";
  pctBps?: number | null;
  flatAmountKobo?: number | null;
  triggerEvent: "signup" | "kyc_complete" | "funded" | "first_transaction" | "renewal";
  recurrenceMonths: number;
  recurrenceIntervalMonths?: number;
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
    recurrenceIntervalMonths: input.triggerEvent === "renewal" ? input.recurrenceIntervalMonths ?? 1 : 1,
    recurrenceMonths: input.triggerEvent === "renewal" ? input.recurrenceMonths : 1,
  };
  if (!Number.isInteger(normalized.recurrenceMonths) || normalized.recurrenceMonths < 1 || normalized.recurrenceMonths > 12) throw new Error("Maximum recurrence cycles must be between 1 and 12");
  if (!Number.isInteger(normalized.recurrenceIntervalMonths) || normalized.recurrenceIntervalMonths < 1 || normalized.recurrenceIntervalMonths > 12) throw new Error("Recurrence interval must be between 1 and 12 months");
  const vendorCommissionKobo = calculateVendorCommissionKobo(normalized, sampleAmountKobo);
  return { ...normalized, sampleAmountKobo, ...splitCommission(vendorCommissionKobo) };
}
