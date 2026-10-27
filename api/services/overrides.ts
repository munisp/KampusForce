export const CAMPUS_LEAD_OVERRIDE_BPS = 500;

export function calculateLeadOverride(teamCommissionKobo: number, platformMarginKobo: number) {
  if (!Number.isInteger(teamCommissionKobo) || teamCommissionKobo <= 0) throw new Error("Team commission must be positive kobo");
  if (!Number.isInteger(platformMarginKobo) || platformMarginKobo < 0) throw new Error("Platform margin must be valid kobo");
  const overrideKobo = Math.round((teamCommissionKobo * CAMPUS_LEAD_OVERRIDE_BPS) / 10_000);
  if (overrideKobo > platformMarginKobo) throw new Error("Lead override exceeds available platform margin");
  return {
    basisPoints: CAMPUS_LEAD_OVERRIDE_BPS,
    teamCommissionKobo,
    overrideKobo,
    platformMarginKobo,
    platformMarginAfterKobo: platformMarginKobo - overrideKobo,
  };
}

export type LeadEligibilityRow = {
  repId: number;
  campusId: number;
  confirmedCommissionKobo: number;
  activationCount: number;
};

export function rankTopDecile(rows: LeadEligibilityRow[]) {
  const ranked = [...rows].sort((a, b) => b.confirmedCommissionKobo - a.confirmedCommissionKobo || b.activationCount - a.activationCount || a.repId - b.repId);
  const eligibleSlots = ranked.length ? Math.max(1, Math.ceil(ranked.length * 0.1)) : 0;
  return ranked.map((row, index) => ({ ...row, rank: index + 1, topDecileEligible: index < eligibleSlots }));
}
