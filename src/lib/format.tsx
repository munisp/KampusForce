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
  on_sale: "On sale", paused: "Paused", taken_down: "Taken down",
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`state-badge state-${state}`}><span aria-hidden="true" />{stateLabel[state] || state.replaceAll("_", " ")}</span>;
}

export const productCategories: Record<string, string> = {
  fintech: "Fintech", airtime_data: "Airtime & data", devices: "Devices", edtech: "Edtech", micro_insurance: "Micro-insurance", other: "Other products",
};

/** Why a fraud review was opened, in plain words. */
export const fraudReasonLabel = (reason: string) => ({ activation_velocity: "Many sales in one day", operations_review: "Opened by Operations" } as Record<string, string>)[reason] || reason.replaceAll("_", " ");

/** The activity log in plain words. Unknown actions fall back to their own name, made readable. */
const ACTIVITY: Record<string, string> = {
  "campus_lead.eligibility_recalculated": "Campus lead eligibility rechecked", "campus_lead.promoted": "Campus lead appointed", "campus_lead.demoted": "Campus lead role removed",
  "identity.document_uploaded": "ID document uploaded", "identity.document_viewed": "ID document viewed", "identity.case_opened": "ID check opened", "identity.evidence_recorded": "ID check result recorded",
  "identity.onboarding_submitted": "ID check sent for review", "identity.approve": "ID check approved", "identity.request_info": "More ID information requested", "identity.consent_withdrawn": "ID consent withdrawn",
  "identity.manual_review_requested": "ID check sent for manual review",
  "payout.attempt_reserved": "Payout started", "payout.interrupted_sandbox_dispatch_recovered": "Interrupted test payout recovered", "payout.instant_requested": "Payout requested after an approved sale",
  "payout.batch_queued": "Payout queued", "payout.confirmation_sweep": "Waiting periods checked", "payout.batch_completed": "Payout run finished", "payout.destination_replaced": "Bank account changed",
  "payout.destination_configured": "Bank account added", "payout.destination_approved": "Bank account confirmed", "payout.destination_rejected": "Bank account not confirmed",
  "sandbox.confirmation_windows_advanced": "Test mode: waiting periods skipped",
  "recorded_sale.created": "Sale recorded", "recorded_sale.approved": "Sale approved", "recorded_sale.rejected": "Sale rejected",
  "vendor.product_added": "Product listed", "vendor.product_paused": "Product paused", "vendor.product_resumed": "Product back on sale", "vendor.product_updated": "Product edited", "vendor.product_image_added": "Product photo added",
  "vendor.webhook_credential.rotated": "Vendor system key changed", "operations.product_held": "Product taken down", "operations.product_hold_released": "Product hold lifted",
  "dispute.opened": "Dispute opened", "dispute.resolved": "Dispute decided", "dispute.rejected": "Dispute rejected", "dispute.commission_reversed": "Commission taken back", "dispute.commission_corrected": "Commission corrected",
  "registration.completed": "Signed up", "rep.activated": "Rep activated", "recruitment.accepted": "Invitation accepted",
  "training.module_created": "Lesson created", "training.module_updated": "Lesson edited", "training.module_archived": "Lesson archived",
  "escrow.funded": "Vendor wallet funded", "escrow.funding_started": "Vendor started adding funds", "campaign.created": "Campaign created", "promotion.created": "Promotion created",
  "campus.created": "Campus added", "campus.status_changed": "Campus status changed", "crm.opportunity_created": "Contact added", "fraud.case.opened": "Fraud review opened", "fraud.case.released": "Fraud review closed, payouts resumed",
  "reconciliation.batch_recorded": "Bank check recorded", "maintenance.test_campaigns_removed": "Test campaigns removed",
};
export const activityLabel = (action: string) => ACTIVITY[action] || ((s: string) => s.charAt(0).toUpperCase() + s.slice(1))(action.split(".").pop()!.replaceAll("_", " "));
