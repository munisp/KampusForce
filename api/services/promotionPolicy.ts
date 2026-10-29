export const PROMOTION_EVENT_TYPES = [
  "promotion.approved",
  "promotion.started",
  "recruitment.target_at_risk",
  "recruitment.target_met",
  "promotion.paused",
  "promotion.budget_exhausted",
  "promotion.ended",
  "activation.confirmed",
] as const;

export type PromotionEventType = typeof PROMOTION_EVENT_TYPES[number];

export const DEFAULT_PROMOTION_TRIGGERS: Array<{
  eventType: PromotionEventType;
  action: string;
  configJson: Record<string, unknown>;
}> = [
  { eventType: "promotion.approved", action: "create_recruitment_draft", configJson: {} },
  { eventType: "promotion.started", action: "activate_recruitment_and_acquisition", configJson: {} },
  { eventType: "recruitment.target_at_risk", action: "notify_accountable_recruiters", configJson: { warningHours: 48 } },
  { eventType: "recruitment.target_met", action: "stop_new_invitations", configJson: { preserveExistingOnboarding: true } },
  { eventType: "promotion.paused", action: "pause_recruitment_and_acquisition", configJson: {} },
  { eventType: "promotion.budget_exhausted", action: "stop_new_activation_submissions", configJson: { preserveEarnedPayouts: true } },
  { eventType: "promotion.ended", action: "close_acquisition_preserve_history", configJson: {} },
  { eventType: "activation.confirmed", action: "record_verified_promotion_outcome", configJson: {} },
];

export function evaluatePromotionCapacity(input: {
  budgetCapKobo: number;
  committedKobo: number;
  escrowBalanceKobo: number;
  pendingVendorCommitmentsKobo: number;
  nextCommissionKobo: number;
}) {
  const remainingBudgetKobo = Math.max(0, input.budgetCapKobo - input.committedKobo);
  const uncommittedEscrowKobo = Math.max(0, input.escrowBalanceKobo - input.pendingVendorCommitmentsKobo);
  if (input.nextCommissionKobo > remainingBudgetKobo) {
    return { allowed: false, reason: "budget_cap" as const, remainingBudgetKobo, uncommittedEscrowKobo };
  }
  if (input.nextCommissionKobo > uncommittedEscrowKobo) {
    return { allowed: false, reason: "escrow_depleted" as const, remainingBudgetKobo, uncommittedEscrowKobo };
  }
  return { allowed: true, reason: null, remainingBudgetKobo, uncommittedEscrowKobo };
}

export function evaluateStaffingProgress(input: {
  target: number;
  activated: number;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  warningPct?: number;
}) {
  const progressPct = input.target > 0 ? Math.min(100, Math.round(input.activated / input.target * 100)) : 100;
  const duration = Math.max(1, input.endsAt.getTime() - input.startsAt.getTime());
  const elapsedPct = Math.max(0, Math.min(100, Math.round((input.now.getTime() - input.startsAt.getTime()) / duration * 100)));
  const warningPct = input.warningPct ?? 80;
  const targetMet = input.activated >= input.target;
  const atRisk = !targetMet && input.now < input.endsAt && elapsedPct >= warningPct && progressPct < elapsedPct;
  return { progressPct, elapsedPct, targetMet, atRisk };
}

export function scheduledPromotionTransition(input: {
  state: string;
  startsAt: Date;
  endsAt: Date;
  now: Date;
}) {
  if (input.endsAt <= input.now) return "promotion.ended" as const;
  if (["approved", "scheduled"].includes(input.state) && input.startsAt <= input.now) return "promotion.started" as const;
  return null;
}
