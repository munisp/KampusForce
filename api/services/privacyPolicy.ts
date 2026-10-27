export const DSAR_RESPONSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const BREACH_TRIAGE_WINDOW_MS = 72 * 60 * 60 * 1000;

export type DsarLifecycleState = "received" | "identity_verified" | "in_review" | "fulfilled" | "rejected";
export type BreachLifecycleState = "reported" | "assessing" | "decision_recorded" | "closed";

export function dsarDueAt(receivedAt: Date) {
  return new Date(receivedAt.getTime() + DSAR_RESPONSE_WINDOW_MS);
}

export function breachTriageDueAt(detectedAt: Date) {
  return new Date(detectedAt.getTime() + BREACH_TRIAGE_WINDOW_MS);
}

export function canExportDsar(state: DsarLifecycleState) {
  return ["identity_verified", "in_review", "fulfilled"].includes(state);
}

export function isDsarOpen(state: DsarLifecycleState) {
  return !["fulfilled", "rejected"].includes(state);
}

export function isDsarOverdue(input: { state: DsarLifecycleState; dueAt: Date }, now = new Date()) {
  return isDsarOpen(input.state) && input.dueAt.getTime() < now.getTime();
}

export function isBreachTriageOverdue(input: { state: BreachLifecycleState; triageDueAt: Date }, now = new Date()) {
  return ["reported", "assessing"].includes(input.state) && input.triageDueAt.getTime() < now.getTime();
}
