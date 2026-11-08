/** Naira, with kobo shown whenever there are any, so a ₦1,999.99 price never reads as ₦2,000. */
export function money(kobo = 0) {
  const digits = Math.round(kobo) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(kobo / 100);
}

export function shortDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function fullDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export const stateLabel: Record<string, string> = {
  pending: "Waiting", confirmed: "Confirmed", payable: "Ready to pay", paid: "Paid", disputed: "Disputed", void: "Cancelled", clawed_back: "Taken back", failed: "Failed",
  draft: "Not submitted", processing: "Being checked", manual_review: "Being reviewed", needs_more_info: "More info needed", verified: "Confirmed", revoked: "Cancelled", blocked: "Not ready", quarantined: "Held", dead_letter: "Couldn't process",
  assigned: "Not started", in_progress: "In progress", completed: "Passed",
  on_sale: "On sale", paused: "Paused",
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`state-badge state-${state}`}><span aria-hidden="true" />{stateLabel[state] || state.replaceAll("_", " ")}</span>;
}

export const productCategories: Record<string, string> = {
  fintech: "Fintech", airtime_data: "Airtime & data", devices: "Devices", edtech: "Edtech", micro_insurance: "Micro-insurance", other: "Other products",
};

/** Why a fraud review was opened, in plain words. */
export const fraudReasonLabel = (reason: string) => ({ activation_velocity: "Many sales in one day", operations_review: "Opened by Operations" } as Record<string, string>)[reason] || reason.replaceAll("_", " ");
