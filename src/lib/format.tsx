export function money(kobo = 0) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
}

export function shortDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export const stateLabel: Record<string, string> = {
  pending: "Pending", confirmed: "Confirmed", payable: "Payable", paid: "Paid", disputed: "Disputed", void: "Void", clawed_back: "Clawed back", failed: "Failed",
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`state-badge state-${state}`}><span aria-hidden="true" />{stateLabel[state] || state.replaceAll("_", " ")}</span>;
}

export const productCategories: Record<string, string> = {
  fintech: "Fintech", airtime_data: "Airtime & data", devices: "Devices", edtech: "Edtech", micro_insurance: "Micro-insurance",
};
