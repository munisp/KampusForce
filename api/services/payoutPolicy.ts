export const MAX_PAYOUT_ATTEMPTS = 3;
export const RECONCILIATION_TOLERANCE_KOBO = 100_000;

export function payoutProviderForAttempt(attemptNo: number) {
  if (!Number.isInteger(attemptNo) || attemptNo < 1 || attemptNo > MAX_PAYOUT_ATTEMPTS) {
    throw new Error("Payout attempt number must be between 1 and 3");
  }
  return attemptNo === MAX_PAYOUT_ATTEMPTS ? "flutterwave_sandbox" : "paystack_sandbox";
}

export function retryDelayMinutes(failedAttemptNo: number) {
  if (failedAttemptNo === 1) return 1;
  if (failedAttemptNo === 2) return 5;
  return 0;
}

function watDate(date: Date) {
  // Africa/Lagos is UTC+01:00 and does not observe daylight-saving time.
  return new Date(date.getTime() + 60 * 60_000);
}

export function isDailyPayoutWindow(date: Date) {
  return watDate(date).getUTCHours() === 9;
}

export function dailyPayoutSlotKey(date: Date) {
  return `${watDate(date).toISOString().slice(0, 10)}-09:00-WAT`;
}

export function assessReconciliation(input: {
  complete: boolean;
  ledgerKobo: number;
  providerKobo: number;
  bankKobo: number;
}) {
  if (!input.complete) return { state: "pending" as const, varianceKobo: 0 };
  const values = [input.ledgerKobo, input.providerKobo, input.bankKobo];
  const varianceKobo = Math.max(...values) - Math.min(...values);
  if (varianceKobo === 0) return { state: "matched" as const, varianceKobo };
  return {
    state: varianceKobo > RECONCILIATION_TOLERANCE_KOBO ? "variance" as const : "within_tolerance" as const,
    varianceKobo,
  };
}
