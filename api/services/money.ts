export type CommissionRuleLike = {
  basis: "flat" | "pct";
  pctBps: number | null;
  flatAmountKobo: number | null;
};

export function calculateVendorCommissionKobo(rule: CommissionRuleLike, eventAmountKobo: number | null): number {
  if (rule.basis === "flat") {
    if (!rule.flatAmountKobo || rule.flatAmountKobo <= 0) throw new Error("Flat commission rule has no valid amount");
    return Math.round(rule.flatAmountKobo);
  }
  if (!rule.pctBps || rule.pctBps <= 0 || !eventAmountKobo || eventAmountKobo <= 0) {
    throw new Error("Percentage commission requires a positive event amount and rate");
  }
  return Math.round((eventAmountKobo * rule.pctBps) / 10_000);
}

export function splitCommission(vendorCommissionKobo: number, takeRateBps = 2_000) {
  if (!Number.isInteger(vendorCommissionKobo) || vendorCommissionKobo <= 0) throw new Error("Commission must be positive kobo");
  const platformFeeKobo = Math.round((vendorCommissionKobo * takeRateBps) / 10_000);
  return { vendorCommissionKobo, platformFeeKobo, repCommissionKobo: vendorCommissionKobo - platformFeeKobo };
}

export function withholdingKobo(grossKobo: number, rateBps = 1_000) {
  return Math.round((grossKobo * rateBps) / 10_000);
}

export function naira(kobo: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
}
