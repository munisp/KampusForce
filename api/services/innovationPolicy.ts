export type ControlCondition = { field: string; operator: string; value: string | number | boolean };

export function simulatePromotionTwin(input: {
  representatives: number;
  activationsPerRepresentative: number;
  vendorCommissionKobo: number;
  budgetCapKobo: number;
  escrowKobo: number;
  refundPct: number;
}) {
  const integers = ["representatives", "activationsPerRepresentative", "vendorCommissionKobo", "budgetCapKobo", "escrowKobo"] as const;
  for (const key of integers) if (!Number.isSafeInteger(input[key]) || input[key] < 0) throw new Error(`${key} must be a non-negative safe integer`);
  if (!Number.isFinite(input.refundPct) || input.refundPct < 0 || input.refundPct > 100) throw new Error("refundPct must be between 0 and 100");
  const projectedGross = input.representatives * input.activationsPerRepresentative;
  const activationCapacity = input.vendorCommissionKobo === 0 ? (projectedGross === 0 ? 0 : 0) : Math.floor(Math.min(input.budgetCapKobo, input.escrowKobo) / input.vendorCommissionKobo);
  const fundedActivations = Math.min(projectedGross, activationCapacity);
  const expectedNetActivations = Math.floor(fundedActivations * (100 - input.refundPct) / 100);
  return {
    projectedGrossActivations: projectedGross,
    fundedActivations,
    expectedNetActivations,
    unfundedActivations: Math.max(0, projectedGross - fundedActivations),
    committedBudgetKobo: fundedActivations * input.vendorCommissionKobo,
    uncommittedBudgetKobo: Math.max(0, input.budgetCapKobo - fundedActivations * input.vendorCommissionKobo),
    constrained: projectedGross > fundedActivations,
    constraint: projectedGross > fundedActivations ? "budget_or_escrow" : "demand_assumption",
    liveStateChanged: false,
    commissionEntitlementCreated: false,
  };
}

export function evaluateControlConditions(conditions: ControlCondition[], input: Record<string, unknown>) {
  const explanations: string[] = [];
  let matched = true;
  for (const condition of conditions) {
    if (!/^[a-z][a-zA-Z0-9_.]{0,80}$/.test(condition.field)) throw new Error("Control field names must be explicit scalar paths");
    const actual = condition.field.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, input);
    if (actual !== undefined && !["string", "number", "boolean"].includes(typeof actual)) throw new Error("Control conditions can inspect scalar values only");
    let result = false;
    switch (condition.operator) {
      case "eq": result = actual === condition.value; break;
      case "neq": result = actual !== condition.value; break;
      case "gt": result = typeof actual === "number" && actual > Number(condition.value); break;
      case "gte": result = typeof actual === "number" && actual >= Number(condition.value); break;
      case "lt": result = typeof actual === "number" && actual < Number(condition.value); break;
      case "lte": result = typeof actual === "number" && actual <= Number(condition.value); break;
      case "contains": result = typeof actual === "string" && actual.toLowerCase().includes(String(condition.value).toLowerCase()); break;
      case "in": result = String(condition.value).split(",").map((item) => item.trim()).includes(String(actual)); break;
      default: throw new Error(`Unsupported control operator: ${condition.operator}`);
    }
    matched &&= result;
    explanations.push(`${condition.field} ${condition.operator} ${JSON.stringify(condition.value)} → ${result ? "matched" : "not matched"}`);
  }
  return { matched, explanation: explanations.length ? explanations.join("; ") : "No conditions; the control matches its declared trigger only" };
}

export function suppressSmallCohorts<T extends { key: string; cohort: number; numerator: number; denominator: number }>(cells: T[], minimumCohort = 5) {
  if (!Number.isSafeInteger(minimumCohort) || minimumCohort < 5) throw new Error("Benchmark cohort threshold must be at least five");
  return cells.map((cell) => cell.cohort < minimumCohort
    ? { key: cell.key, cohort: 0, numerator: 0, denominator: 0, suppressed: true }
    : { key: cell.key, cohort: cell.cohort, numerator: cell.numerator, denominator: cell.denominator, suppressed: false });
}

export function riskAdaptiveTiming(input: {
  openFraudCases: number;
  criticalAssuranceCases: number;
  outcomeMismatches: number;
  priorChargebacks: number;
  vendorCommissionKobo: number;
}) {
  for (const [key, value] of Object.entries(input)) if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, condition: boolean, reason: string) => { if (condition) { score += points; reasons.push(reason); } };
  add(45, input.openFraudCases > 0, `${input.openFraudCases} open fraud case(s)`);
  add(35, input.criticalAssuranceCases > 0, `${input.criticalAssuranceCases} critical assurance case(s)`);
  add(25, input.outcomeMismatches > 0, `${input.outcomeMismatches} independent outcome mismatch(es)`);
  add(15, input.priorChargebacks > 0, `${input.priorChargebacks} earlier chargeback signal(s)`);
  add(5, input.vendorCommissionKobo >= 1_000_000, "Higher-value commission merits an additional evidence check");
  score = Math.min(100, score);
  if (!reasons.length) reasons.push("No configured elevated-risk signals were present");
  return {
    score,
    reasons,
    recommendedReviewHours: score >= 60 ? 4 : score >= 25 ? 12 : 24,
    recommendedPayoutDelayHours: score >= 60 ? 72 : score >= 25 ? 24 : 0,
    automaticFinancialAction: false,
  };
}

export function forecastAmountKobo(rows: Array<{ expectedCommissionKobo: number; probability: number; stage: string }>, scenario: "commit" | "best" | "pipeline") {
  const multiplier = scenario === "commit" ? 0.8 : scenario === "best" ? 1.15 : 1;
  return Math.round(rows.reduce((sum, row) => {
    if (!Number.isSafeInteger(row.expectedCommissionKobo) || row.expectedCommissionKobo < 0) throw new Error("Forecast amounts must be non-negative safe integers");
    if (["won", "lost"].includes(row.stage)) return sum;
    if (scenario === "commit" && !["qualified", "activation_pending"].includes(row.stage)) return sum;
    const probability = scenario === "best" && row.stage === "activation_pending" ? 100 : row.probability;
    return sum + row.expectedCommissionKobo * probability / 100;
  }, 0) * multiplier);
}

export function nextBestRelationshipAction(input: {
  stage: string;
  openTasks: number;
  overdueTasks: number;
  daysQuiet: number;
  hasConsent: boolean;
}) {
  if (input.overdueTasks > 0) return { actionType: "complete_overdue_task", priority: 95, recommendation: "Complete or reschedule the overdue relationship task before adding outreach.", reasons: [`${input.overdueTasks} task(s) are overdue`] };
  if (input.daysQuiet >= 7 && !input.hasConsent) return { actionType: "refresh_purpose_consent", priority: 90, recommendation: "Do not send promotional outreach; refresh and record purpose-specific consent first.", reasons: [`${input.daysQuiet} quiet days`, "No current consent for relationship outreach"] };
  if (input.stage === "activation_pending") return { actionType: "verify_vendor_outcome", priority: 85, recommendation: "Ask the vendor to reconcile the pending activation through its verified event flow.", reasons: ["CRM cannot confirm an activation or mark Won without vendor evidence"] };
  if (input.openTasks === 0) return { actionType: "schedule_next_step", priority: 70, recommendation: "Schedule one specific next step with an owner and due date.", reasons: ["No open task currently protects the next action"] };
  return { actionType: "record_relationship_context", priority: 50, recommendation: "Record the customer’s requested outcome and agreed next step.", reasons: ["A current task exists; improve the evidence around it"] };
}

export function redactSensitiveText(value: string) {
  const redactions: string[] = [];
  let text = value;
  const apply = (pattern: RegExp, label: string, replacement: string) => {
    const count = (text.match(pattern) || []).length;
    if (count) { redactions.push(`${label}:${count}`); text = text.replace(pattern, replacement); }
  };
  apply(/\b\d{11}\b/g, "national_identifier", "[redacted-identifier]");
  apply(/\b\+?\d[\d\s-]{8,16}\d\b/g, "phone", "[redacted-phone]");
  apply(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "email", "[redacted-email]");
  apply(/\b(?:nin|bvn)\s*[:#-]?\s*\S+/gi, "identity_reference", "[redacted-identity-reference]");
  return { text, redactions };
}

export function buildCaseCopilot(input: { subject: string; description: string; state: string; messages: string[] }) {
  const redacted = redactSensitiveText([input.description, ...input.messages].join("\n"));
  const summary = redacted.text.split("\n").filter(Boolean).map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" ").slice(0, 900) || "No investigation detail has been recorded.";
  const actions = [
    input.state === "rep_triage" ? "Confirm ownership and escalate with the evidence already recorded." : "Confirm the named owner and next customer-visible update.",
    "Compare the case with approved knowledge before drafting a public reply.",
    "Record independent evidence for any vendor-outcome discrepancy; do not alter commission state from this case.",
  ];
  return { summary: `${input.subject}: ${summary}`.slice(0, 1000), redactions: redacted.redactions, suggestedActions: actions, modelVersion: "deterministic-case-copilot-v1" };
}

export function qualityReviewTotal(scores: Record<string, number>) {
  const required = ["ownership", "evidence", "communication", "privacy", "resolution"];
  let total = 0;
  for (const key of required) {
    const score = scores[key];
    if (!Number.isFinite(score) || score < 0 || score > 20) throw new Error(`${key} must be scored from 0 to 20`);
    total += score;
  }
  if (Object.keys(scores).some((key) => !required.includes(key))) throw new Error("Unknown quality rubric category");
  return Math.round(total);
}

export function addBusinessMinutes(start: Date, minutes: number, input?: { businessDays?: number[]; startMinute?: number; endMinute?: number; timezoneOffsetMinutes?: number }) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error("Business minutes must be a non-negative integer");
  const businessDays = input?.businessDays || [1, 2, 3, 4, 5];
  const startMinute = input?.startMinute ?? 480;
  const endMinute = input?.endMinute ?? 1020;
  if (startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) throw new Error("Invalid business-hours window");
  const timezoneOffsetMinutes = input?.timezoneOffsetMinutes ?? 0;
  if (!Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) throw new Error("Invalid fixed timezone offset");
  const cursor = new Date(start.getTime() + timezoneOffsetMinutes * 60_000);
  let remaining = minutes;
  let guard = 0;
  while (guard++ < 10000) {
    const day = cursor.getUTCDay();
    const minute = cursor.getUTCHours() * 60 + cursor.getUTCMinutes();
    if (!businessDays.includes(day) || minute >= endMinute) {
      cursor.setUTCHours(0, 0, 0, 0);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      continue;
    }
    if (minute < startMinute) {
      cursor.setUTCHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
      continue;
    }
    const available = endMinute - minute;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60_000 - timezoneOffsetMinutes * 60_000);
    remaining -= available;
    cursor.setUTCHours(Math.floor(endMinute / 60), endMinute % 60, 0, 0);
  }
  throw new Error("Business-hours calculation exceeded its bounded horizon");
}
