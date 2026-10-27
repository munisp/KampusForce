import type { FraudCase, FraudHold } from "@db/schema";

export const DEFAULT_ACTIVATION_CAP_PER_REP_DAY = 10;
export const FRAUD_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const WAT_OFFSET_MS = 60 * 60 * 1000;

export function activationDayWindow(date: Date) {
  const wat = new Date(date.getTime() + WAT_OFFSET_MS);
  const windowStart = new Date(Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()) - WAT_OFFSET_MS);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
  return { windowStart, windowEnd, localDay: wat.toISOString().slice(0, 10) };
}

export function fraudReviewDueAt(createdAt: Date) {
  return new Date(createdAt.getTime() + FRAUD_REVIEW_WINDOW_MS);
}

export function isFraudReviewOverdue(fraudCase: Pick<FraudCase, "state" | "reviewDueAt">, now = new Date()) {
  return ["open", "appeal_open"].includes(fraudCase.state) && fraudCase.reviewDueAt.getTime() < now.getTime();
}

export function isBlockingFraudHold(hold: Pick<FraudHold, "state">) {
  return hold.state === "active" || hold.state === "upheld";
}

export function activationCapExceeded(attemptCount: number, cap: number) {
  return attemptCount > cap;
}
