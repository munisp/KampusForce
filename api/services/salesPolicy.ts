export const OPEN_OPPORTUNITY_STAGES = ["targeted", "contacted", "qualified", "activation_pending"] as const;

export const stageProbability: Record<string, number> = {
  targeted: 10,
  contacted: 25,
  qualified: 50,
  activation_pending: 75,
  won: 100,
  lost: 0,
};

export function probabilityForStage(stage: string) {
  const probability = stageProbability[stage];
  if (probability === undefined) throw new Error("Unknown opportunity stage");
  return probability;
}

export function opportunityStall(input: {
  stage: string;
  lastActivityAt: Date;
  nextActionAt?: Date | null;
}, now = new Date()) {
  if (!OPEN_OPPORTUNITY_STAGES.includes(input.stage as typeof OPEN_OPPORTUNITY_STAGES[number])) {
    return { stalled: false, reason: null as string | null, quietDays: 0 };
  }
  const quietDays = Math.max(0, Math.floor((now.getTime() - input.lastActivityAt.getTime()) / 86_400_000));
  if (input.nextActionAt && input.nextActionAt <= now) {
    return { stalled: true, reason: `Next action was due ${input.nextActionAt.toISOString()}`, quietDays };
  }
  if (quietDays >= 7) {
    return { stalled: true, reason: `No recorded relationship activity for ${quietDays} days`, quietDays };
  }
  return { stalled: false, reason: null as string | null, quietDays };
}

export function weightedForecastKobo(rows: Array<{ expectedCommissionKobo: number; probability: number; stage: string }>) {
  return rows.reduce((total, row) => {
    if (!OPEN_OPPORTUNITY_STAGES.includes(row.stage as typeof OPEN_OPPORTUNITY_STAGES[number])) return total;
    if (!Number.isSafeInteger(row.expectedCommissionKobo) || row.expectedCommissionKobo < 0) throw new Error("Invalid forecast amount");
    return total + Math.round(row.expectedCommissionKobo * row.probability / 100);
  }, 0);
}

export function scoreProductFit(input: {
  vendorQualityScore: number;
  campusActivations: number;
  repCategoryActivations: number;
  requiredTrainingCompleted: boolean;
  alreadyRecommended: boolean;
}) {
  let score = 25;
  const reasons: string[] = ["Active vendor product with versioned commercial terms"];
  score += Math.round(Math.max(0, Math.min(100, input.vendorQualityScore)) * 0.2);
  if (input.campusActivations > 0) {
    const points = Math.min(20, input.campusActivations * 4);
    score += points;
    reasons.push(`${input.campusActivations} verified campus activation${input.campusActivations === 1 ? "" : "s"} indicate local demand`);
  }
  if (input.repCategoryActivations > 0) {
    score += Math.min(20, input.repCategoryActivations * 5);
    reasons.push("Matches categories where this rep already has verified outcomes");
  }
  if (input.requiredTrainingCompleted) {
    score += 10;
    reasons.push("Required sales-ethics training is complete");
  } else {
    reasons.push("Complete required training to improve readiness");
  }
  if (input.alreadyRecommended) score = Math.min(score, 99);
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export function scoreOpportunity(input: {
  stage: string;
  productFitScore: number;
  hasConsentedAttribution: boolean;
  activityCount: number;
  nextActionAt?: Date | null;
}, now = new Date()) {
  let score = Math.round(Math.max(0, Math.min(100, input.productFitScore)) * 0.45);
  const reasons = [`Product-fit evidence contributes ${score} points`];
  const stagePoints = probabilityForStage(input.stage) * 0.25;
  score += Math.round(stagePoints);
  reasons.push(`Pipeline stage contributes ${Math.round(stagePoints)} points`);
  if (input.hasConsentedAttribution) {
    score += 15;
    reasons.push("Privacy-preserving first-touch attribution exists");
  }
  if (input.activityCount > 0) {
    const points = Math.min(10, input.activityCount * 2);
    score += points;
    reasons.push(`${input.activityCount} recorded activit${input.activityCount === 1 ? "y" : "ies"} add ${points} points`);
  }
  if (input.nextActionAt && input.nextActionAt > now) {
    score += 5;
    reasons.push("A future next action is scheduled");
  }
  return { score: Math.min(100, score), reasons };
}

export function caseRisk(input: {
  priority: string;
  state: string;
  slaDueAt: Date;
  firstResponseDueAt?: Date | null;
  firstRespondedAt?: Date | null;
  assigneeUserId?: number | null;
  snoozedUntil?: Date | null;
}, now = new Date()) {
  if (["resolved", "closed"].includes(input.state)) return { score: 0, reasons: ["Case is resolved"] };
  let score = input.priority === "urgent" ? 35 : 10;
  const reasons = input.priority === "urgent" ? ["Urgent priority"] : ["Normal priority"];
  if (input.slaDueAt <= now) {
    score += 35;
    reasons.push("Resolution SLA is overdue");
  } else if (input.slaDueAt.getTime() - now.getTime() <= 4 * 3_600_000) {
    score += 15;
    reasons.push("Resolution SLA is due within four hours");
  }
  if (!input.firstRespondedAt && input.firstResponseDueAt && input.firstResponseDueAt <= now) {
    score += 20;
    reasons.push("First-response target is overdue");
  }
  if (!input.assigneeUserId) {
    score += 10;
    reasons.push("No named case owner");
  }
  if (input.snoozedUntil && input.snoozedUntil > now) {
    score = Math.min(score, 20);
    reasons.push(`Snoozed until ${input.snoozedUntil.toISOString()}`);
  }
  return { score: Math.min(100, score), reasons };
}

export function caseNextAction(input: {
  state: string;
  assigneeUserId?: number | null;
  firstRespondedAt?: Date | null;
  snoozedUntil?: Date | null;
}, now = new Date()) {
  if (["resolved", "closed"].includes(input.state)) return "Review the resolution or reopen with new evidence";
  if (input.snoozedUntil && input.snoozedUntil > now) return "Waiting for the scheduled wake-up; edit the snooze if circumstances change";
  if (!input.assigneeUserId) return "Assign a named owner before the next customer-visible action";
  if (!input.firstRespondedAt) return "Send a public first response, then record the investigation plan";
  if (input.state === "rep_triage") return "Add evidence and escalate to the campus lead or vendor";
  if (input.state === "vendor_queue") return "Review vendor evidence and resolve or escalate to Operations";
  return "Record an internal finding and agree the next resolution step";
}

export function buildOutreachDraft(input: {
  alias: string;
  productName: string;
  stage: string;
  lastActivityBody?: string;
  nextActionAt?: Date | null;
}) {
  const context = input.lastActivityBody?.trim()
    ? `Following up on our last step: ${input.lastActivityBody.slice(0, 140)}. `
    : "Following up on the product terms you reviewed. ";
  const timing = input.nextActionAt ? ` I planned to reconnect by ${input.nextActionAt.toISOString().slice(0, 10)}.` : "";
  const body = `Hi ${input.alias}, ${context}Would you like to review ${input.productName} and its activation requirements together? KYC and payment stay inside the vendor’s own flow.${timing}`;
  const rationale = `Drafted from the ${input.stage.replaceAll("_", " ")} stage, latest recorded activity and scheduled follow-up. No message is sent automatically.`;
  return { body, rationale };
}

export function validateCampaignWindow(startsAt: Date, endsAt: Date, now = new Date()) {
  if (startsAt.getTime() < now.getTime() - 5 * 60_000) throw new Error("Campaign start cannot be more than five minutes in the past");
  if (endsAt <= startsAt) throw new Error("Campaign end must be after its start");
  if (endsAt.getTime() - startsAt.getTime() > 92 * 86_400_000) throw new Error("Campaign window cannot exceed 92 days");
}

export function leaderboardPoints(input: { confirmedActivations: number; confirmedCommissionKobo: number; qualityScore: number; completedTraining: number }) {
  if (input.confirmedActivations < 0 || input.confirmedCommissionKobo < 0 || input.completedTraining < 0) throw new Error("Leaderboard inputs cannot be negative");
  return input.confirmedActivations * 100 + Math.floor(input.confirmedCommissionKobo / 10_000) + Math.round(Math.max(0, Math.min(100, input.qualityScore)) / 10) + Math.min(5, input.completedTraining) * 25;
}
