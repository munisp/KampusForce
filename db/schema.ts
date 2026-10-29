import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  json,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const campusStatusEnum = pgEnum("campus_status", ["planned", "launching", "live", "paused"]);
export const userRoleEnum = pgEnum("user_role", ["rep", "vendor", "ops", "finance", "admin"]);
export const kycStateEnum = pgEnum("kyc_state", ["unverified", "pending", "verified", "rejected"]);
export const repTierEnum = pgEnum("rep_tier", ["starter", "bronze", "silver", "gold", "campus_lead"]);
export const repStatusEnum = pgEnum("rep_status", ["pending", "active", "held", "suspended"]);
export const fraudCaseReasonEnum = pgEnum("fraud_case_reason", ["activation_velocity", "operations_review"]);
export const fraudCaseStateEnum = pgEnum("fraud_case_state", ["open", "released", "upheld", "appeal_open"]);
export const fraudHoldStateEnum = pgEnum("fraud_hold_state", ["active", "released", "upheld"]);
export const fraudConductActionEnum = pgEnum("fraud_conduct_action", ["none", "strike", "suspension"]);
export const vendorStatusEnum = pgEnum("vendor_status", ["pending", "active", "paused"]);
export const productCategoryEnum = pgEnum("product_category", ["fintech", "airtime_data", "devices", "edtech", "micro_insurance"]);
export const productStatusEnum = pgEnum("product_status", ["draft", "active", "paused"]);
export const commissionBasisEnum = pgEnum("commission_basis", ["flat", "pct"]);
export const commissionTriggerEnum = pgEnum("commission_trigger", ["signup", "kyc_complete", "funded", "first_transaction", "renewal"]);
export const ruleDraftStateEnum = pgEnum("rule_draft_state", ["draft", "published", "expired"]);
export const attributionSourceEnum = pgEnum("attribution_source", ["link", "qr", "assisted", "claim"]);
export const attributionStatusEnum = pgEnum("attribution_status", ["active", "expired", "disputed"]);
export const vendorEventTypeEnum = pgEnum("vendor_event_type", ["account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]);
export const vendorEventStatusEnum = pgEnum("vendor_event_status", ["processed", "ignored", "quarantined"]);
export const webhookCredentialStateEnum = pgEnum("webhook_credential_state", ["active", "retiring", "revoked"]);
export const ingestionRetryStateEnum = pgEnum("ingestion_retry_state", ["retry_scheduled", "resolved", "dead_letter"]);
export const dealStateEnum = pgEnum("deal_state", ["pending", "confirmed", "payable", "paid", "disputed", "void", "clawed_back", "failed"]);
export const recruitmentStatusEnum = pgEnum("recruitment_status", ["invited", "accepted", "activated", "revoked", "expired"]);
export const jobRunStatusEnum = pgEnum("job_run_status", ["running", "succeeded", "failed"]);
export const overrideStateEnum = pgEnum("override_state", ["accrued", "paid", "reversed"]);
export const ledgerAccountEnum = pgEnum("ledger_account", ["rep_payable", "lead_override_payable", "platform_revenue", "vendor_escrow", "clawback_reserve", "withholding_tax", "external_bank"]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);
export const payoutStateEnum = pgEnum("payout_state", ["queued", "processing", "paid", "failed", "held"]);
export const payoutAttemptStateEnum = pgEnum("payout_attempt_state", ["initiated", "succeeded", "failed"]);
export const reconciliationStateEnum = pgEnum("reconciliation_state", ["pending", "matched", "within_tolerance", "variance"]);
export const assistedSessionStatusEnum = pgEnum("assisted_session_status", ["active", "completed", "abandoned"]);
export const disputeStateEnum = pgEnum("dispute_state", ["open", "reviewing", "resolved", "rejected"]);
export const supportPriorityEnum = pgEnum("support_priority", ["normal", "urgent"]);
export const supportTicketStateEnum = pgEnum("support_ticket_state", ["rep_triage", "campus_lead_queue", "vendor_queue", "ops_queue", "resolved", "closed"]);
export const incidentSeverityEnum = pgEnum("incident_severity", ["info", "warning", "critical"]);
export const incidentStateEnum = pgEnum("incident_state", ["open", "acknowledged", "resolved"]);
export const dsarRequestTypeEnum = pgEnum("dsar_request_type", ["access", "rectification", "erasure", "objection"]);
export const dsarStateEnum = pgEnum("dsar_state", ["received", "identity_verified", "in_review", "fulfilled", "rejected"]);
export const breachAssessmentStateEnum = pgEnum("breach_assessment_state", ["reported", "assessing", "decision_recorded", "closed"]);
export const breachRiskEnum = pgEnum("breach_risk", ["low", "medium", "high"]);
export const breachNotificationDecisionEnum = pgEnum("breach_notification_decision", ["pending", "not_required", "required"]);
export const launchTrackEnum = pgEnum("launch_track", ["legal", "finance", "ops", "engineering", "product"]);
export const launchGateStateEnum = pgEnum("launch_gate_state", ["not_started", "evidence_submitted", "approved", "rejected"]);
export const providerWebhookStateEnum = pgEnum("provider_webhook_state", ["processed", "ignored", "quarantined"]);
export const rolloutSubjectTypeEnum = pgEnum("rollout_subject_type", ["campus_cohort", "phase_quarter"]);
export const rolloutEvidenceSourceEnum = pgEnum("rollout_evidence_source", ["system_snapshot", "external_evidence"]);
export const rolloutEvidenceStateEnum = pgEnum("rollout_evidence_state", ["recorded", "submitted", "approved", "rejected"]);
export const rolloutMetricUnitEnum = pgEnum("rollout_metric_unit", ["count", "percent", "naira", "months", "kobo", "ratio"]);
export const caseMessageVisibilityEnum = pgEnum("case_message_visibility", ["internal", "public"]);
export const caseLinkTypeEnum = pgEnum("case_link_type", ["related", "duplicate", "blocks"]);
export const opportunityStageEnum = pgEnum("opportunity_stage", ["targeted", "contacted", "qualified", "activation_pending", "won", "lost"]);
export const opportunityTaskStateEnum = pgEnum("opportunity_task_state", ["open", "completed", "dismissed"]);
export const outreachDraftStateEnum = pgEnum("outreach_draft_state", ["draft", "approved", "shared", "dismissed"]);
export const trainingProgressStateEnum = pgEnum("training_progress_state", ["assigned", "in_progress", "completed"]);
export const campaignStateEnum = pgEnum("campaign_state", ["draft", "pending_review", "approved", "scheduled", "active", "paused", "completed", "rejected"]);
export const campaignGoalEnum = pgEnum("campaign_goal", ["activation", "recruitment", "training", "reactivation"]);
export const campaignEnrollmentStateEnum = pgEnum("campaign_enrollment_state", ["enrolled", "notified", "suppressed", "converted"]);
export const integrationServiceEnum = pgEnum("integration_service", ["catalog", "crm", "support", "messaging"]);
export const integrationModeEnum = pgEnum("integration_mode", ["sandbox", "live"]);
export const integrationStateEnum = pgEnum("integration_state", ["configured", "verified", "degraded", "disabled"]);
export const promotionStateEnum = pgEnum("promotion_state", ["draft", "pending_review", "approved", "scheduled", "active", "paused", "budget_exhausted", "completed", "rejected"]);
export const promotionLinkStateEnum = pgEnum("promotion_link_state", ["active", "revoked"]);
export const promotionOrchestrationStateEnum = pgEnum("promotion_orchestration_state", ["pending", "processing", "processed", "failed", "dead_letter"]);
export const promotionChannelEnum = pgEnum("promotion_channel", ["email", "sms", "whatsapp"]);
export const promotionConsentStateEnum = pgEnum("promotion_consent_state", ["consented", "suppressed"]);
export const promotionDeliveryStateEnum = pgEnum("promotion_delivery_state", ["simulated", "blocked", "queued", "completed"]);
export const recommendationStateEnum = pgEnum("recommendation_state", ["suggested", "accepted", "dismissed", "converted"]);
export const studentReferralStateEnum = pgEnum("student_referral_state", ["suggested", "invited", "declined"]);
export const financialPostingStateEnum = pgEnum("financial_posting_state", ["pending", "submitting", "submitted", "reconciled", "failed", "blocked"]);
export const mojaloopIntentStateEnum = pgEnum("mojaloop_intent_state", ["disabled", "party_resolved", "quoted", "transfer_pending", "settled", "failed"]);
export const dataPlatformRunStateEnum = pgEnum("data_platform_run_state", ["running", "succeeded", "failed", "blocked"]);


export const campuses = pgTable("campuses", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  state: varchar("state", { length: 80 }).notNull(),
  status: campusStatusEnum("status").notNull().default("planned"),
  launchDate: timestamp("launch_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  role: userRoleEnum("role").notNull().default("rep"),
  kycState: kycStateEnum("kyc_state").notNull().default("unverified"),
  ninToken: varchar("nin_token", { length: 128 }),
  ninLast4: varchar("nin_last4", { length: 4 }),
  bankName: varchar("bank_name", { length: 120 }),
  bankCode: varchar("bank_code", { length: 12 }),
  bankAccountLast4: varchar("bank_account_last4", { length: 4 }),
  bankAccountName: varchar("bank_account_name", { length: 160 }),
  bankNameMatch: boolean("bank_name_match").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reps = pgTable("reps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  code: varchar("code", { length: 32 }).notNull().unique(),
  tier: repTierEnum("tier").notNull().default("starter"),
  qualityScore: integer("quality_score").notNull().default(100),
  status: repStatusEnum("status").notNull().default("pending"),
  contractorAgreementSignedAt: timestamp("contractor_agreement_signed_at", { withTimezone: true }),
  leadPreviousTier: repTierEnum("lead_previous_tier"),
  leadPromotedAt: timestamp("lead_promoted_at", { withTimezone: true }),
  leadDemotedAt: timestamp("lead_demoted_at", { withTimezone: true }),
  leadDemotionReason: varchar("lead_demotion_reason", { length: 300 }),
  leadEligibilitySyncedAt: timestamp("lead_eligibility_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  companyName: varchar("company_name", { length: 180 }).notNull(),
  cacNumber: varchar("cac_number", { length: 40 }),
  webhookKey: varchar("webhook_key", { length: 80 }).notNull().unique(),
  webhookSecret: varchar("webhook_secret", { length: 128 }).notNull(),
  status: vendorStatusEnum("status").notNull().default("pending"),
  supportSlaHours: integer("support_sla_hours").notNull().default(24),
  qualityScore: integer("quality_score").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendorWebhookCredentials = pgTable("vendor_webhook_credentials", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  keyVersion: integer("key_version").notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  state: webhookCredentialStateEnum("state").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("vendor_webhook_credential_version_unique").on(t.vendorId, t.keyVersion), index("vendor_webhook_credential_state_idx").on(t.vendorId, t.state, t.expiresAt)]);

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  vendorRef: varchar("vendor_ref", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  category: productCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  priceKobo: bigint("price_kobo", { mode: "number" }).notNull().default(0),
  landingUrl: varchar("landing_url", { length: 500 }).notNull(),
  pitchScript: text("pitch_script").notNull(),
  status: productStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commissionRules = pgTable("commission_rules", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  version: integer("version").notNull().default(1),
  basis: commissionBasisEnum("basis").notNull(),
  pctBps: integer("pct_bps"),
  flatAmountKobo: bigint("flat_amount_kobo", { mode: "number" }),
  triggerEvent: commissionTriggerEnum("trigger_event").notNull(),
  recurrenceMonths: integer("recurrence_months").notNull().default(1),
  confirmDays: integer("confirm_days").notNull().default(30),
  clawbackDays: integer("clawback_days").notNull().default(60),
  activationCapPerRepDay: integer("activation_cap_per_rep_day").notNull().default(10),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
});

export const commissionRuleDrafts = pgTable("commission_rule_drafts", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  basis: commissionBasisEnum("basis").notNull(),
  pctBps: integer("pct_bps"),
  flatAmountKobo: bigint("flat_amount_kobo", { mode: "number" }),
  triggerEvent: commissionTriggerEnum("trigger_event").notNull(),
  recurrenceMonths: integer("recurrence_months").notNull().default(1),
  confirmDays: integer("confirm_days").notNull().default(30),
  clawbackDays: integer("clawback_days").notNull().default(60),
  activationCapPerRepDay: integer("activation_cap_per_rep_day").notNull().default(10),
  sampleAmountKobo: bigint("sample_amount_kobo", { mode: "number" }),
  vendorCommissionKobo: bigint("vendor_commission_kobo", { mode: "number" }).notNull(),
  repCommissionKobo: bigint("rep_commission_kobo", { mode: "number" }).notNull(),
  platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }).notNull(),
  state: ruleDraftStateEnum("state").notNull().default("draft"),
  publishedRuleId: integer("published_rule_id").references(() => commissionRules.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attributionRecords = pgTable(
  "attribution_records",
  {
    id: serial("id").primaryKey(),
    repId: integer("rep_id").notNull().references(() => reps.id),
    customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
    productId: integer("product_id").notNull().references(() => products.id),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id),
    promotionId: integer("promotion_id").references(() => vendorPromotions.id),
    firstTouchAt: timestamp("first_touch_at", { withTimezone: true }).notNull().defaultNow(),
    source: attributionSourceEnum("source").notNull(),
    tokenSig: varchar("token_sig", { length: 128 }).notNull(),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    status: attributionStatusEnum("status").notNull().default("active"),
  },
  (t) => [uniqueIndex("attribution_customer_vendor_unique").on(t.customerPhoneHash, t.vendorId), index("attribution_promotion_idx").on(t.promotionId, t.firstTouchAt)],
);

export const vendorEvents = pgTable("vendor_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  type: vendorEventTypeEnum("type").notNull(),
  customerRefHash: varchar("customer_ref_hash", { length: 64 }).notNull(),
  productId: integer("product_id").references(() => products.id),
  amountKobo: bigint("amount_kobo", { mode: "number" }),
  payloadJson: json("payload_json").notNull(),
  hmacOk: boolean("hmac_ok").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: varchar("dedupe_key", { length: 160 }).notNull().unique(),
  status: vendorEventStatusEnum("status").notNull().default("processed"),
  quarantineReason: varchar("quarantine_reason", { length: 300 }),
  webhookCredentialId: integer("webhook_credential_id").references(() => vendorWebhookCredentials.id),
  dealId: integer("deal_id").references(() => deals.id),
  payloadRetainUntil: timestamp("payload_retain_until", { withTimezone: true }).notNull().defaultNow(),
  payloadPurgedAt: timestamp("payload_purged_at", { withTimezone: true }),
}, (t) => [index("vendor_event_retention_idx").on(t.payloadRetainUntil, t.payloadPurgedAt), index("vendor_event_deal_idx").on(t.dealId)]);

export const vendorIngestionRetries = pgTable("vendor_ingestion_retries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  dedupeKey: varchar("dedupe_key", { length: 160 }).notNull().unique(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  type: vendorEventTypeEnum("type").notNull(),
  payloadJson: json("payload_json").notNull(),
  customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
  customerRefHash: varchar("customer_ref_hash", { length: 64 }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  state: ingestionRetryStateEnum("state").notNull().default("retry_scheduled"),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).notNull(),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  vendorEventId: varchar("vendor_event_id", { length: 36 }).references(() => vendorEvents.id),
  promotionLinkId: integer("promotion_link_id").references(() => promotionLinks.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [index("vendor_ingestion_retry_due_idx").on(t.state, t.nextRetryAt), index("vendor_ingestion_retry_vendor_idx").on(t.vendorId, t.state)]);

export const activationVelocityBuckets = pgTable(
  "activation_velocity_buckets",
  {
    id: serial("id").primaryKey(),
    repId: integer("rep_id").notNull().references(() => reps.id),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    cap: integer("cap").notNull().default(10),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("activation_velocity_rep_window_unique").on(t.repId, t.windowStart), index("activation_velocity_window_idx").on(t.windowStart, t.repId)],
);

export const fraudCases = pgTable(
  "fraud_cases",
  {
    id: serial("id").primaryKey(),
    caseRef: varchar("case_ref", { length: 40 }).notNull().unique(),
    repId: integer("rep_id").notNull().references(() => reps.id),
    reason: fraudCaseReasonEnum("reason").notNull(),
    state: fraudCaseStateEnum("state").notNull().default("open"),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull().unique(),
    sourceKey: varchar("source_key", { length: 180 }),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }).notNull(),
    evidenceJson: json("evidence_json").$type<Record<string, unknown>>().notNull().default({}),
    openedByUserId: integer("opened_by_user_id").references(() => users.id),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    conductAction: fraudConductActionEnum("conduct_action").notNull().default("none"),
    priorRepStatus: repStatusEnum("prior_rep_status"),
    appealNote: text("appeal_note"),
    appealRequestedAt: timestamp("appeal_requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fraud_case_rep_state_idx").on(t.repId, t.state), index("fraud_case_review_due_idx").on(t.state, t.reviewDueAt), index("fraud_case_source_idx").on(t.sourceKey, t.createdAt)],
);

export const fraudHolds = pgTable(
  "fraud_holds",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id").notNull().references(() => fraudCases.id).unique(),
    repId: integer("rep_id").notNull().references(() => reps.id),
    state: fraudHoldStateEnum("state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("fraud_hold_rep_state_idx").on(t.repId, t.state)],
);

export const fraudCaseEvents = pgTable(
  "fraud_case_events",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id").notNull().references(() => fraudCases.id),
    actorUserId: integer("actor_user_id").references(() => users.id),
    action: varchar("action", { length: 80 }).notNull(),
    fromState: fraudCaseStateEnum("from_state"),
    toState: fraudCaseStateEnum("to_state"),
    note: text("note"),
    evidenceJson: json("evidence_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fraud_case_event_idx").on(t.caseId, t.createdAt)],
);

export const deals = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    attributionId: integer("attribution_id").notNull().references(() => attributionRecords.id),
    productId: integer("product_id").notNull().references(() => products.id),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id),
    repId: integer("rep_id").notNull().references(() => reps.id),
    commissionRuleId: integer("commission_rule_id").references(() => commissionRules.id),
    customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
    triggerEvent: varchar("trigger_event", { length: 40 }).notNull(),
    eventId: varchar("event_id", { length: 36 }).notNull().unique(),
    state: dealStateEnum("state").notNull().default("pending"),
    payoutId: integer("payout_id"),
    vendorCommissionKobo: bigint("vendor_commission_kobo", { mode: "number" }).notNull(),
    repCommissionKobo: bigint("rep_commission_kobo", { mode: "number" }).notNull(),
    platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }).notNull(),
    confirmAt: timestamp("confirm_at", { withTimezone: true }).notNull(),
    clawbackUntil: timestamp("clawback_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deals_rep_state_idx").on(t.repId, t.state), index("deals_confirm_idx").on(t.state, t.confirmAt), index("deals_payout_idx").on(t.payoutId)],
);

export const dealStateHistory = pgTable("deal_state_history", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  fromState: varchar("from_state", { length: 30 }),
  toState: varchar("to_state", { length: 30 }).notNull(),
  actor: varchar("actor", { length: 100 }).notNull(),
  reason: varchar("reason", { length: 300 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campusLeadAssignments = pgTable(
  "campus_lead_assignments",
  {
    id: serial("id").primaryKey(),
    leadRepId: integer("lead_rep_id").notNull().references(() => reps.id),
    repId: integer("rep_id").notNull().references(() => reps.id),
    campusId: integer("campus_id").notNull().references(() => campuses.id),
    assignedByUserId: integer("assigned_by_user_id").references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("campus_lead_assignment_rep_unique").on(t.repId), index("campus_lead_assignment_lead_idx").on(t.leadRepId, t.revokedAt)],
);

export const campusRecruitments = pgTable("campus_recruitments", {
  id: serial("id").primaryKey(),
  leadRepId: integer("lead_rep_id").notNull().references(() => reps.id),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  name: varchar("name", { length: 160 }).notNull(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
  note: varchar("note", { length: 300 }),
  status: recruitmentStatusEnum("status").notNull().default("invited"),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedUserId: integer("accepted_user_id").references(() => users.id),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  activatedByUserId: integer("activated_by_user_id").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: integer("revoked_by_user_id").references(() => users.id),
  source: varchar("source", { length: 60 }).notNull().default("campus_lead"),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  campaignId: integer("campaign_id"),
}, (t) => [uniqueIndex("campus_recruitment_token_unique").on(t.tokenHash), index("campus_recruitment_status_idx").on(t.status, t.expiresAt), index("campus_recruitment_follow_up_idx").on(t.leadRepId, t.nextFollowUpAt)]);

export const jobRuns = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  jobKey: varchar("job_key", { length: 80 }).notNull(),
  slotKey: varchar("slot_key", { length: 100 }).notNull(),
  trigger: varchar("trigger", { length: 20 }).notNull().default("manual"),
  status: jobRunStatusEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  processedCount: integer("processed_count").notNull().default(0),
  resultJson: json("result_json"),
  error: varchar("error", { length: 1000 }),
}, (t) => [uniqueIndex("job_run_slot_unique").on(t.jobKey, t.slotKey), index("job_run_started_idx").on(t.startedAt)]);

export const operationalIncidents = pgTable("operational_incidents", {
  id: serial("id").primaryKey(),
  dedupeKey: varchar("dedupe_key", { length: 160 }).notNull().unique(),
  source: varchar("source", { length: 60 }).notNull(),
  severity: incidentSeverityEnum("severity").notNull(),
  state: incidentStateEnum("state").notNull().default("open"),
  title: varchar("title", { length: 180 }).notNull(),
  detail: text("detail").notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("operational_incident_state_idx").on(t.state, t.severity, t.lastSeenAt), index("operational_incident_entity_idx").on(t.entityType, t.entityId)]);

export const operationalIncidentEvents = pgTable("operational_incident_events", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => operationalIncidents.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 80 }).notNull(),
  fromState: incidentStateEnum("from_state"),
  toState: incidentStateEnum("to_state"),
  note: text("note"),
  evidenceJson: json("evidence_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("operational_incident_event_idx").on(t.incidentId, t.createdAt)]);

export const dsarRequests = pgTable("dsar_requests", {
  id: serial("id").primaryKey(),
  requestRef: varchar("request_ref", { length: 40 }).notNull().unique(),
  customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
  requestType: dsarRequestTypeEnum("request_type").notNull(),
  state: dsarStateEnum("state").notNull().default("received"),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  verifiedByUserId: integer("verified_by_user_id").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcomeNote: text("outcome_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dsar_customer_idx").on(t.customerPhoneHash, t.createdAt),
  index("dsar_state_due_idx").on(t.state, t.dueAt),
]);

export const dsarRequestEvents = pgTable("dsar_request_events", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => dsarRequests.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 80 }).notNull(),
  fromState: dsarStateEnum("from_state"),
  toState: dsarStateEnum("to_state"),
  note: text("note"),
  evidenceJson: json("evidence_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("dsar_request_event_idx").on(t.requestId, t.createdAt)]);

export const breachAssessments = pgTable("breach_assessments", {
  id: serial("id").primaryKey(),
  assessmentRef: varchar("assessment_ref", { length: 40 }).notNull().unique(),
  title: varchar("title", { length: 180 }).notNull(),
  summary: text("summary").notNull(),
  state: breachAssessmentStateEnum("state").notNull().default("reported"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  triageDueAt: timestamp("triage_due_at", { withTimezone: true }).notNull(),
  risk: breachRiskEnum("risk"),
  notificationDecision: breachNotificationDecisionEnum("notification_decision").notNull().default("pending"),
  notificationOwnerUserId: integer("notification_owner_user_id").references(() => users.id),
  decisionNote: text("decision_note"),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  closureNote: text("closure_note"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("breach_assessment_state_due_idx").on(t.state, t.triageDueAt)]);

export const breachAssessmentEvents = pgTable("breach_assessment_events", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => breachAssessments.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 80 }).notNull(),
  fromState: breachAssessmentStateEnum("from_state"),
  toState: breachAssessmentStateEnum("to_state"),
  note: text("note"),
  evidenceJson: json("evidence_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("breach_assessment_event_idx").on(t.assessmentId, t.createdAt)]);

export const launchGates = pgTable("launch_gates", {
  id: serial("id").primaryKey(),
  gateKey: varchar("gate_key", { length: 100 }).notNull().unique(),
  track: launchTrackEnum("track").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  requirement: text("requirement").notNull(),
  evidenceHint: text("evidence_hint").notNull(),
  state: launchGateStateEnum("state").notNull().default("not_started"),
  required: boolean("required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  evidenceReference: varchar("evidence_reference", { length: 500 }),
  evidenceNote: text("evidence_note"),
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalReference: varchar("approval_reference", { length: 500 }),
  rejectionNote: text("rejection_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("launch_gate_track_state_idx").on(t.track, t.state, t.sortOrder)]);

export const launchGateEvents = pgTable("launch_gate_events", {
  id: serial("id").primaryKey(),
  gateId: integer("gate_id").notNull().references(() => launchGates.id),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 40 }).notNull(),
  fromState: launchGateStateEnum("from_state"),
  toState: launchGateStateEnum("to_state").notNull(),
  note: text("note").notNull(),
  evidenceJson: json("evidence_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("launch_gate_event_idx").on(t.gateId, t.createdAt)]);

export const campusCohorts = pgTable("campus_cohorts", {
  id: serial("id").primaryKey(),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  label: varchar("label", { length: 120 }).notNull(),
  cohortStartDate: date("cohort_start_date").notNull(),
  monthOneEndDate: date("month_one_end_date").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("campus_cohort_campus_label_unique").on(t.campusId, t.label), index("campus_cohort_period_idx").on(t.campusId, t.cohortStartDate, t.monthOneEndDate)]);

export const rolloutQuarters = pgTable("rollout_quarters", {
  id: serial("id").primaryKey(),
  phase: integer("phase").notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  quarterStartDate: date("quarter_start_date").notNull(),
  quarterEndDate: date("quarter_end_date").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("rollout_quarter_phase_start_unique").on(t.phase, t.quarterStartDate), index("rollout_quarter_phase_period_idx").on(t.phase, t.quarterStartDate, t.quarterEndDate)]);

export const rolloutEvidence = pgTable("rollout_evidence", {
  id: serial("id").primaryKey(),
  subjectType: rolloutSubjectTypeEnum("subject_type").notNull(),
  subjectId: integer("subject_id").notNull(),
  metricKey: varchar("metric_key", { length: 100 }).notNull(),
  sourceType: rolloutEvidenceSourceEnum("source_type").notNull(),
  realWorldAttested: boolean("real_world_attested").notNull().default(false),
  state: rolloutEvidenceStateEnum("state").notNull(),
  metricValue: numeric("metric_value", { precision: 24, scale: 6 }).notNull(),
  unit: rolloutMetricUnitEnum("unit").notNull(),
  periodStartDate: date("period_start_date").notNull(),
  periodEndDate: date("period_end_date").notNull(),
  evidenceReference: varchar("evidence_reference", { length: 500 }).notNull(),
  note: text("note").notNull(),
  submittedByUserId: integer("submitted_by_user_id").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReference: varchar("review_reference", { length: 500 }),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rollout_evidence_subject_metric_idx").on(t.subjectType, t.subjectId, t.metricKey, t.submittedAt), index("rollout_evidence_review_idx").on(t.state, t.sourceType, t.reviewedAt)]);

export const rolloutEvidenceEvents = pgTable("rollout_evidence_events", {
  id: serial("id").primaryKey(),
  evidenceId: integer("evidence_id").notNull().references(() => rolloutEvidence.id),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 60 }).notNull(),
  fromState: rolloutEvidenceStateEnum("from_state"),
  toState: rolloutEvidenceStateEnum("to_state").notNull(),
  note: text("note").notNull(),
  evidenceJson: json("evidence_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rollout_evidence_event_idx").on(t.evidenceId, t.createdAt)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  id: serial("id").primaryKey(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  policy: varchar("policy", { length: 60 }).notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rate_limit_expiry_idx").on(t.expiresAt), index("rate_limit_policy_idx").on(t.policy, t.windowStartedAt)]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 60 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: varchar("body", { length: 1000 }).notNull(),
  href: varchar("href", { length: 300 }),
  entityType: varchar("entity_type", { length: 60 }),
  entityId: varchar("entity_id", { length: 100 }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notification_user_idx").on(t.userId, t.readAt, t.createdAt)]);

export const campusLeadOverrides = pgTable(
  "campus_lead_overrides",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id").notNull().references(() => deals.id),
    leadRepId: integer("lead_rep_id").notNull().references(() => reps.id),
    sourceRepId: integer("source_rep_id").notNull().references(() => reps.id),
    campusId: integer("campus_id").notNull().references(() => campuses.id),
    basisPoints: integer("basis_points").notNull().default(500),
    teamCommissionKobo: bigint("team_commission_kobo", { mode: "number" }).notNull(),
    overrideKobo: bigint("override_kobo", { mode: "number" }).notNull(),
    platformMarginKobo: bigint("platform_margin_kobo", { mode: "number" }).notNull(),
    platformMarginAfterKobo: bigint("platform_margin_after_kobo", { mode: "number" }).notNull(),
    state: overrideStateEnum("state").notNull().default("accrued"),
    payoutId: integer("payout_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("campus_lead_override_deal_unique").on(t.dealId), index("campus_lead_override_lead_idx").on(t.leadRepId, t.state)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    dealId: integer("deal_id").references(() => deals.id),
    payoutId: integer("payout_id"),
    account: ledgerAccountEnum("account").notNull(),
    direction: ledgerDirectionEnum("direction").notNull(),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    entryGroup: varchar("entry_group", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_group_idx").on(t.entryGroup), index("ledger_deal_idx").on(t.dealId)],
);

export const escrowWallets = pgTable("escrow_wallets", {
  vendorId: integer("vendor_id").primaryKey().references(() => vendors.id),
  balanceKobo: bigint("balance_kobo", { mode: "number" }).notNull().default(0),
  lowBalanceThresholdKobo: bigint("low_balance_threshold_kobo", { mode: "number" }).notNull().default(10000000),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable("payouts", {
  id: serial("id").primaryKey(),
  repId: integer("rep_id").notNull().references(() => reps.id),
  amountGrossKobo: bigint("amount_gross_kobo", { mode: "number" }).notNull(),
  amountNetKobo: bigint("amount_net_kobo", { mode: "number" }).notNull(),
  withholdingKobo: bigint("withholding_kobo", { mode: "number" }).notNull().default(0),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerRef: varchar("provider_ref", { length: 100 }).notNull().unique(),
  state: payoutStateEnum("state").notNull().default("queued"),
  batchId: varchar("batch_id", { length: 64 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lastFailureCode: varchar("last_failure_code", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [index("payout_dispatch_idx").on(t.state, t.nextRetryAt), index("payout_batch_idx").on(t.batchId)]);

export const payoutAttempts = pgTable("payout_attempts", {
  id: serial("id").primaryKey(),
  payoutId: integer("payout_id").notNull().references(() => payouts.id),
  attemptNo: integer("attempt_no").notNull(),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerRef: varchar("provider_ref", { length: 100 }).notNull().unique(),
  state: payoutAttemptStateEnum("state").notNull().default("initiated"),
  failureCode: varchar("failure_code", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("payout_attempt_number_unique").on(t.payoutId, t.attemptNo), index("payout_attempt_payout_idx").on(t.payoutId, t.state)]);

export const providerWebhookEvents = pgTable("provider_webhook_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  provider: varchar("provider", { length: 40 }).notNull(),
  eventKey: varchar("event_key", { length: 64 }).notNull().unique(),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  payoutId: integer("payout_id").references(() => payouts.id),
  payloadJson: json("payload_json").$type<Record<string, unknown>>().notNull(),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  state: providerWebhookStateEnum("state").notNull().default("processed"),
  quarantineReason: varchar("quarantine_reason", { length: 300 }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [index("provider_webhook_payout_idx").on(t.payoutId, t.receivedAt), index("provider_webhook_state_idx").on(t.state, t.receivedAt)]);

export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: serial("id").primaryKey(),
  batchId: varchar("batch_id", { length: 64 }).notNull(),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  ledgerKobo: bigint("ledger_kobo", { mode: "number" }).notNull(),
  providerKobo: bigint("provider_kobo", { mode: "number" }).notNull(),
  bankKobo: bigint("bank_kobo", { mode: "number" }).notNull(),
  varianceKobo: bigint("variance_kobo", { mode: "number" }).notNull(),
  state: reconciliationStateEnum("state").notNull(),
  evidence: varchar("evidence", { length: 40 }).notNull().default("sandbox_records"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("reconciliation_batch_idx").on(t.batchId, t.createdAt)]);

export const assistedSessions = pgTable("assisted_sessions", {
  id: serial("id").primaryKey(),
  repId: integer("rep_id").notNull().references(() => reps.id),
  productId: integer("product_id").notNull().references(() => products.id),
  customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
  currentStep: integer("current_step").notNull().default(1),
  status: assistedSessionStatusEnum("status").notNull().default("active"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputes = pgTable("disputes", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  openedBy: integer("opened_by").notNull().references(() => users.id),
  reasonCode: varchar("reason_code", { length: 80 }).notNull(),
  evidenceJson: json("evidence_json"),
  state: disputeStateEnum("state").notNull().default("open"),
  decision: text("decision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    ticketRef: varchar("ticket_ref", { length: 40 }).notNull().unique(),
    repId: integer("rep_id").notNull().references(() => reps.id),
    vendorId: integer("vendor_id").notNull().references(() => vendors.id),
    customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
    dealId: integer("deal_id").references(() => deals.id),
    category: varchar("category", { length: 80 }).notNull(),
    subject: varchar("subject", { length: 180 }).notNull(),
    description: text("description").notNull(),
    priority: supportPriorityEnum("priority").notNull().default("normal"),
    state: supportTicketStateEnum("state").notNull().default("rep_triage"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
    resolution: text("resolution"),
    resolutionMacroId: integer("resolution_macro_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    csat: integer("csat"),
    csatComment: varchar("csat_comment", { length: 500 }),
    assigneeUserId: integer("assignee_user_id").references(() => users.id),
    version: integer("version").notNull().default(1),
    firstResponseDueAt: timestamp("first_response_due_at", { withTimezone: true }),
    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    lastPublicReplyAt: timestamp("last_public_reply_at", { withTimezone: true }),
    reopenedCount: integer("reopened_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_ticket_rep_idx").on(t.repId, t.state), index("support_ticket_vendor_sla_idx").on(t.vendorId, t.state, t.slaDueAt)],
);

export const supportTicketEvents = pgTable("support_ticket_events", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  actorRole: varchar("actor_role", { length: 40 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  fromState: varchar("from_state", { length: 40 }),
  toState: varchar("to_state", { length: 40 }),
  note: text("note"),
  evidenceJson: json("evidence_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportResolutionMacros = pgTable("support_resolution_macros", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  approvedByUserId: integer("approved_by_user_id").notNull().references(() => users.id),
  active: boolean("active").notNull().default(true),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consentLogs = pgTable("consent_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  phoneHash: varchar("phone_hash", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 160 }).notNull(),
  policyVersion: varchar("policy_version", { length: 30 }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: varchar("entity_id", { length: 80 }).notNull(),
  metadataJson: json("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpChallenges = pgTable("otp_challenges", {
  id: serial("id").primaryKey(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const caseMessages = pgTable("case_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  visibility: caseMessageVisibilityEnum("visibility").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_message_ticket_idx").on(t.ticketId, t.createdAt), index("case_message_visibility_idx").on(t.visibility, t.createdAt)]);

export const caseLinks = pgTable("case_links", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  relatedTicketId: integer("related_ticket_id").notNull().references(() => supportTickets.id),
  linkType: caseLinkTypeEnum("link_type").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_link_pair_type_unique").on(t.ticketId, t.relatedTicketId, t.linkType), index("case_link_related_idx").on(t.relatedTicketId)]);

export const caseWatchers = pgTable("case_watchers", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_watcher_unique").on(t.ticketId, t.userId), index("case_watcher_user_idx").on(t.userId, t.createdAt)]);

export const caseSavedViews = pgTable("case_saved_views", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  filtersJson: json("filters_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_saved_view_user_name_unique").on(t.userId, t.name)]);

export const opportunities = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  opportunityRef: varchar("opportunity_ref", { length: 40 }).notNull().unique(),
  alias: varchar("alias", { length: 120 }).notNull(),
  repId: integer("rep_id").notNull().references(() => reps.id),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  productId: integer("product_id").notNull().references(() => products.id),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  customerPhoneHash: varchar("customer_phone_hash", { length: 64 }),
  stage: opportunityStageEnum("stage").notNull().default("targeted"),
  score: integer("score").notNull().default(0),
  scoreReasons: json("score_reasons").$type<string[]>().notNull().default([]),
  expectedCommissionKobo: bigint("expected_commission_kobo", { mode: "number" }).notNull().default(0),
  probability: integer("probability").notNull().default(10),
  nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  lostReason: text("lost_reason"),
  version: integer("version").notNull().default(1),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("opportunity_rep_stage_idx").on(t.repId, t.stage, t.nextActionAt), index("opportunity_campus_product_idx").on(t.campusId, t.productId, t.stage), index("opportunity_customer_idx").on(t.customerPhoneHash, t.vendorId)]);

export const opportunityActivities = pgTable("opportunity_activities", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  activityType: varchar("activity_type", { length: 60 }).notNull(),
  body: text("body").notNull(),
  metadataJson: json("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("opportunity_activity_timeline_idx").on(t.opportunityId, t.createdAt)]);

export const opportunityTasks = pgTable("opportunity_tasks", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  assignedRepId: integer("assigned_rep_id").notNull().references(() => reps.id),
  title: varchar("title", { length: 200 }).notNull(),
  state: opportunityTaskStateEnum("state").notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("opportunity_task_due_idx").on(t.assignedRepId, t.state, t.dueAt)]);

export const outreachDrafts = pgTable("outreach_drafts", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  body: text("body").notNull(),
  rationale: text("rationale").notNull(),
  state: outreachDraftStateEnum("state").notNull().default("draft"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sharedAt: timestamp("shared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("outreach_draft_opportunity_idx").on(t.opportunityId, t.state, t.createdAt)]);

export const crmSegments = pgTable("crm_segments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  filtersJson: json("filters_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_segment_user_name_unique").on(t.userId, t.name)]);

export const trainingModules = pgTable("training_modules", {
  id: serial("id").primaryKey(),
  moduleKey: varchar("module_key", { length: 80 }).notNull().unique(),
  title: varchar("title", { length: 180 }).notNull(),
  summary: text("summary").notNull(),
  content: text("content").notNull(),
  category: varchar("category", { length: 60 }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  passingScore: integer("passing_score").notNull().default(80),
  required: boolean("required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  quizJson: json("quiz_json").$type<Array<{ question: string; options: string[]; answerIndex: number }>>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingProgress = pgTable("training_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  moduleId: integer("module_id").notNull().references(() => trainingModules.id),
  state: trainingProgressStateEnum("state").notNull().default("assigned"),
  bestScore: integer("best_score").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("training_progress_user_module_unique").on(t.userId, t.moduleId), index("training_progress_state_idx").on(t.userId, t.state)]);

export const trainingAttempts = pgTable("training_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  moduleId: integer("module_id").notNull().references(() => trainingModules.id),
  score: integer("score").notNull(),
  passed: boolean("passed").notNull(),
  answersJson: json("answers_json").$type<number[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("training_attempt_user_module_idx").on(t.userId, t.moduleId, t.createdAt)]);

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  campaignKey: varchar("campaign_key", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  goal: campaignGoalEnum("goal").notNull(),
  state: campaignStateEnum("state").notNull().default("draft"),
  vendorId: integer("vendor_id").references(() => vendors.id),
  productId: integer("product_id").references(() => products.id),
  campusId: integer("campus_id").references(() => campuses.id),
  audienceRules: json("audience_rules").$type<Record<string, unknown>>().notNull().default({}),
  messageDraft: text("message_draft").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("campaign_state_schedule_idx").on(t.state, t.startsAt, t.endsAt), index("campaign_audience_idx").on(t.campusId, t.productId, t.goal)]);

export const campaignEnrollments = pgTable("campaign_enrollments", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id),
  repId: integer("rep_id").notNull().references(() => reps.id),
  state: campaignEnrollmentStateEnum("state").notNull().default("enrolled"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("campaign_enrollment_unique").on(t.campaignId, t.repId), index("campaign_enrollment_rep_idx").on(t.repId, t.state)]);

export const campaignEvents = pgTable("campaign_events", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id),
  enrollmentId: integer("enrollment_id").references(() => campaignEnrollments.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  metadataJson: json("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("campaign_event_idx").on(t.campaignId, t.eventType, t.createdAt)]);

export const vendorPromotions = pgTable("vendor_promotions", {
  id: serial("id").primaryKey(),
  promotionKey: varchar("promotion_key", { length: 60 }).notNull().unique(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  productId: integer("product_id").notNull().references(() => products.id),
  campusId: integer("campus_id").references(() => campuses.id),
  name: varchar("name", { length: 180 }).notNull(),
  brief: text("brief").notNull(),
  state: promotionStateEnum("state").notNull().default("draft"),
  budgetCapKobo: bigint("budget_cap_kobo", { mode: "number" }).notNull(),
  recruitmentTarget: integer("recruitment_target").notNull(),
  staffingWarningPct: integer("staffing_warning_pct").notNull().default(80),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  recruitmentCampaignId: integer("recruitment_campaign_id").references(() => campaigns.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  targetMetAt: timestamp("target_met_at", { withTimezone: true }),
  budgetStoppedAt: timestamp("budget_stopped_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("promotion_vendor_state_idx").on(t.vendorId, t.state, t.updatedAt), index("promotion_schedule_idx").on(t.state, t.startsAt, t.endsAt), index("promotion_recruitment_campaign_idx").on(t.recruitmentCampaignId)]);

export const promotionTriggerRules = pgTable("promotion_trigger_rules", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").notNull().references(() => vendorPromotions.id),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  configJson: json("config_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("promotion_trigger_event_unique").on(t.promotionId, t.eventType), index("promotion_trigger_enabled_idx").on(t.promotionId, t.enabled)]);

export const promotionEvents = pgTable("promotion_events", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").notNull().references(() => vendorPromotions.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  metadataJson: json("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("promotion_event_idx").on(t.promotionId, t.createdAt)]);

export const promotionOrchestrationEvents = pgTable("promotion_orchestration_events", {
  id: serial("id").primaryKey(),
  eventKey: varchar("event_key", { length: 180 }).notNull().unique(),
  promotionId: integer("promotion_id").notNull().references(() => vendorPromotions.id),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  payloadJson: json("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  state: promotionOrchestrationStateEnum("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: varchar("last_error", { length: 1000 }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("promotion_orchestration_due_idx").on(t.state, t.availableAt), index("promotion_orchestration_promotion_idx").on(t.promotionId, t.createdAt)]);

export const promotionLinks = pgTable("promotion_links", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").notNull().references(() => vendorPromotions.id),
  repId: integer("rep_id").notNull().references(() => reps.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  state: promotionLinkStateEnum("state").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("promotion_link_rep_idx").on(t.repId, t.state, t.expiresAt), index("promotion_link_promotion_idx").on(t.promotionId, t.state)]);

export const promotionContactConsents = pgTable("promotion_contact_consents", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").notNull().references(() => vendorPromotions.id),
  customerRefHash: varchar("customer_ref_hash", { length: 64 }).notNull(),
  channel: promotionChannelEnum("channel").notNull(),
  state: promotionConsentStateEnum("state").notNull(),
  evidenceRef: varchar("evidence_ref", { length: 160 }).notNull(),
  policyVersion: varchar("policy_version", { length: 60 }).notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("promotion_consent_subject_channel_unique").on(t.promotionId, t.channel, t.customerRefHash), index("promotion_consent_state_idx").on(t.promotionId, t.channel, t.state)]);

export const promotionDeliveryRequests = pgTable("promotion_delivery_requests", {
  id: serial("id").primaryKey(),
  promotionId: integer("promotion_id").notNull().references(() => vendorPromotions.id),
  connectionId: integer("connection_id").references(() => vendorServiceConnections.id),
  channel: promotionChannelEnum("channel").notNull(),
  mode: integrationModeEnum("mode").notNull(),
  state: promotionDeliveryStateEnum("state").notNull(),
  consentedCount: integer("consented_count").notNull(),
  suppressedCount: integer("suppressed_count").notNull(),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id),
  failureReason: text("failure_reason"),
  externalRequestMade: boolean("external_request_made").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [index("promotion_delivery_idx").on(t.promotionId, t.createdAt), index("promotion_delivery_state_idx").on(t.state, t.mode)]);

export const vendorServiceConnections = pgTable("vendor_service_connections", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  service: integrationServiceEnum("service").notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  mode: integrationModeEnum("mode").notNull().default("sandbox"),
  state: integrationStateEnum("state").notNull().default("configured"),
  configJson: json("config_json").$type<Record<string, unknown>>().notNull().default({}),
  externalCredentialRequired: boolean("external_credential_required").notNull().default(true),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("vendor_service_connection_unique").on(t.vendorId, t.service), index("vendor_service_state_idx").on(t.state, t.updatedAt)]);

export const vendorServiceEvents = pgTable("vendor_service_events", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull().references(() => vendorServiceConnections.id),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  status: varchar("status", { length: 40 }).notNull(),
  detail: text("detail").notNull(),
  metadataJson: json("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("vendor_service_event_idx").on(t.connectionId, t.createdAt)]);

export const opportunityRecommendations = pgTable("opportunity_recommendations", {
  id: serial("id").primaryKey(),
  repId: integer("rep_id").notNull().references(() => reps.id),
  productId: integer("product_id").notNull().references(() => products.id),
  score: integer("score").notNull(),
  reasons: json("reasons").$type<string[]>().notNull(),
  state: recommendationStateEnum("state").notNull().default("suggested"),
  opportunityId: integer("opportunity_id").references(() => opportunities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("opportunity_recommendation_rep_product_unique").on(t.repId, t.productId), index("opportunity_recommendation_score_idx").on(t.repId, t.state, t.score)]);

export const studentReferrals = pgTable("student_referrals", {
  id: serial("id").primaryKey(),
  leadRepId: integer("lead_rep_id").notNull().references(() => reps.id),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  candidateName: varchar("candidate_name", { length: 160 }).notNull(),
  strengths: varchar("strengths", { length: 300 }).notNull(),
  note: varchar("note", { length: 500 }),
  consentConfirmed: boolean("consent_confirmed").notNull().default(false),
  state: studentReferralStateEnum("state").notNull().default("suggested"),
  recruitmentId: integer("recruitment_id").references(() => campusRecruitments.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
}, (t) => [index("student_referral_lead_state_idx").on(t.leadRepId, t.state, t.createdAt)]);

export const recruitmentEvents = pgTable("recruitment_events", {
  id: serial("id").primaryKey(),
  recruitmentId: integer("recruitment_id").notNull().references(() => campusRecruitments.id),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 60 }).notNull(),
  fromStatus: recruitmentStatusEnum("from_status"),
  toStatus: recruitmentStatusEnum("to_status"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("recruitment_event_idx").on(t.recruitmentId, t.createdAt)]);

export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: serial("id").primaryKey(),
  snapshotRef: varchar("snapshot_ref", { length: 64 }).notNull().unique(),
  windowDays: integer("window_days").notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  payloadJson: json("payload_json").$type<Record<string, unknown>>().notNull(),
  sourceCountsJson: json("source_counts_json").$type<Record<string, number>>().notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("analytics_snapshot_window_idx").on(t.windowDays, t.createdAt), index("analytics_snapshot_hash_idx").on(t.payloadHash)]);

export const dataPlatformRuns = pgTable("data_platform_runs", {
  id: serial("id").primaryKey(),
  runRef: varchar("run_ref", { length: 80 }).notNull().unique(),
  layer: varchar("layer", { length: 60 }).notNull(),
  engine: varchar("engine", { length: 60 }).notNull(),
  mode: integrationModeEnum("mode").notNull().default("sandbox"),
  state: dataPlatformRunStateEnum("state").notNull(),
  inputHash: varchar("input_hash", { length: 64 }),
  outputHash: varchar("output_hash", { length: 64 }),
  rowsProcessed: integer("rows_processed").notNull().default(0),
  quarantinedRows: integer("quarantined_rows").notNull().default(0),
  detailsJson: json("details_json").$type<Record<string, unknown>>().notNull().default({}),
  deletionEvidenceJson: json("deletion_evidence_json").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("data_platform_run_layer_idx").on(t.layer, t.startedAt), index("data_platform_run_state_idx").on(t.state, t.mode)]);

export const datasetLineage = pgTable("dataset_lineage", {
  id: serial("id").primaryKey(),
  datasetKey: varchar("dataset_key", { length: 100 }).notNull(),
  version: integer("version").notNull(),
  sourceDatasets: json("source_datasets").$type<string[]>().notNull(),
  transform: text("transform").notNull(),
  consentPolicy: varchar("consent_policy", { length: 160 }).notNull(),
  accessScope: varchar("access_scope", { length: 160 }).notNull(),
  outputHash: varchar("output_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("dataset_lineage_version_unique").on(t.datasetKey, t.version), index("dataset_lineage_created_idx").on(t.createdAt)]);

export const financialPostingOutbox = pgTable("financial_posting_outbox", {
  id: serial("id").primaryKey(),
  entryGroup: varchar("entry_group", { length: 64 }).notNull().unique(),
  operation: varchar("operation", { length: 40 }).notNull(),
  payloadJson: json("payload_json").$type<Record<string, unknown>>().notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  state: financialPostingStateEnum("state").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  externalBatchRef: varchar("external_batch_ref", { length: 100 }),
  lastErrorCode: varchar("last_error_code", { length: 160 }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
}, (t) => [index("financial_outbox_dispatch_idx").on(t.state, t.nextRetryAt, t.createdAt), index("financial_outbox_external_idx").on(t.externalBatchRef)]);

export const mojaloopRailIntents = pgTable("mojaloop_rail_intents", {
  id: serial("id").primaryKey(),
  intentRef: varchar("intent_ref", { length: 80 }).notNull().unique(),
  payoutId: integer("payout_id").references(() => payouts.id),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull().unique(),
  partyRefHash: varchar("party_ref_hash", { length: 64 }).notNull(),
  amountNetKobo: bigint("amount_net_kobo", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
  state: mojaloopIntentStateEnum("state").notNull().default("disabled"),
  quoteJson: json("quote_json").$type<Record<string, unknown>>(),
  transferRef: varchar("transfer_ref", { length: 100 }).unique(),
  lastErrorCode: varchar("last_error_code", { length: 160 }),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mojaloop_intent_payout_idx").on(t.payoutId, t.createdAt), index("mojaloop_intent_state_idx").on(t.state, t.updatedAt)]);

export const identityCaseTypeEnum = pgEnum("identity_case_type", ["representative_kyc", "campus_lead_kyc", "vendor_kyb", "operations_kyc", "customer_handoff"]);
export const identityCaseStateEnum = pgEnum("identity_case_state", ["draft", "submitted", "processing", "needs_more_info", "manual_review", "approved", "rejected", "expired", "revoked"]);
export const identitySubjectTypeEnum = pgEnum("identity_subject_type", ["user", "vendor", "customer_handoff"]);
export const identityEvidenceKindEnum = pgEnum("identity_evidence_kind", ["document_ocr", "document_structure", "vlm_extraction", "registry_kyb", "bank_name_match", "liveness", "deepfake", "face_match", "capture_integrity", "reviewer_attestation"]);
export const identityEvidenceStateEnum = pgEnum("identity_evidence_state", ["recorded", "passed", "failed", "review_required", "invalidated"]);
export const identityReviewDecisionEnum = pgEnum("identity_review_decision", ["approve", "request_info", "reject", "revoke"]);
export const identityEventExportStateEnum = pgEnum("identity_event_export_state", ["pending", "exported", "quarantined"]);

export const identityCases = pgTable("identity_cases", {
  id: serial("id").primaryKey(),
  caseRef: varchar("case_ref", { length: 48 }).notNull().unique(),
  caseType: identityCaseTypeEnum("case_type").notNull(),
  subjectType: identitySubjectTypeEnum("subject_type").notNull(),
  subjectId: integer("subject_id").notNull(),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  campusId: integer("campus_id").references(() => campuses.id),
  state: identityCaseStateEnum("state").notNull().default("draft"),
  providerMode: integrationModeEnum("provider_mode").notNull().default("sandbox"),
  policyVersion: varchar("policy_version", { length: 40 }).notNull().default("identity-v1"),
  riskLevel: varchar("risk_level", { length: 20 }).notNull().default("standard"),
  triggerEvent: varchar("trigger_event", { length: 100 }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id),
  decisionReason: varchar("decision_reason", { length: 500 }),
  reviewDueAt: timestamp("review_due_at", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("identity_case_subject_idx").on(t.subjectType, t.subjectId, t.caseType, t.state),
  index("identity_case_review_idx").on(t.state, t.reviewDueAt),
  index("identity_case_expiry_idx").on(t.state, t.validUntil),
]);

export const identityEvidenceMetadata = pgTable("identity_evidence_metadata", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => identityCases.id),
  kind: identityEvidenceKindEnum("kind").notNull(),
  provider: varchar("provider", { length: 80 }).notNull(),
  providerReferenceHash: varchar("provider_reference_hash", { length: 64 }),
  modelVersion: varchar("model_version", { length: 100 }),
  state: identityEvidenceStateEnum("state").notNull(),
  score: numeric("score", { precision: 7, scale: 6 }),
  threshold: numeric("threshold", { precision: 7, scale: 6 }),
  qualityFlags: json("quality_flags").$type<string[]>().notNull().default([]),
  findings: json("findings").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  inputSha256: varchar("input_sha256", { length: 64 }),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("identity_evidence_case_idx").on(t.caseId, t.kind, t.createdAt), index("identity_evidence_provider_idx").on(t.provider, t.state)]);

export const identityReviews = pgTable("identity_reviews", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => identityCases.id),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  decision: identityReviewDecisionEnum("decision").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  previousState: identityCaseStateEnum("previous_state").notNull(),
  resultingState: identityCaseStateEnum("resulting_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("identity_review_case_idx").on(t.caseId, t.createdAt), index("identity_review_actor_idx").on(t.actorUserId, t.createdAt)]);

export const identityConsents = pgTable("identity_consents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => identityCases.id),
  subjectUserId: integer("subject_user_id").references(() => users.id),
  purpose: varchar("purpose", { length: 100 }).notNull(),
  noticeVersion: varchar("notice_version", { length: 40 }).notNull(),
  channel: varchar("channel", { length: 40 }).notNull(),
  noticeHash: varchar("notice_hash", { length: 64 }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
}, (t) => [index("identity_consent_case_idx").on(t.caseId, t.purpose, t.withdrawnAt), index("identity_consent_subject_idx").on(t.subjectUserId, t.withdrawnAt)]);

export const identityLifecycleEvents = pgTable("identity_lifecycle_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  eventId: varchar("event_id", { length: 36 }).notNull().unique(),
  caseId: integer("case_id").references(() => identityCases.id),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  subjectType: identitySubjectTypeEnum("subject_type").notNull(),
  subjectToken: varchar("subject_token", { length: 64 }).notNull(),
  caseType: identityCaseTypeEnum("case_type").notNull(),
  caseState: identityCaseStateEnum("case_state").notNull(),
  providerMode: integrationModeEnum("provider_mode").notNull(),
  payload: json("payload").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  exportState: identityEventExportStateEnum("export_state").notNull().default("pending"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
}, (t) => [index("identity_event_export_idx").on(t.exportState, t.occurredAt), index("identity_event_subject_idx").on(t.subjectToken, t.occurredAt)]);

export type User = typeof users.$inferSelect;
export type Rep = typeof reps.$inferSelect;
export type IdentityCase = typeof identityCases.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type VendorEvent = typeof vendorEvents.$inferSelect;
export type DsarRequest = typeof dsarRequests.$inferSelect;
export type BreachAssessment = typeof breachAssessments.$inferSelect;
export type FraudCase = typeof fraudCases.$inferSelect;
export type FraudHold = typeof fraudHolds.$inferSelect;


export const enrollmentAttestationStateEnum = pgEnum("enrollment_attestation_state", ["submitted", "verified", "rejected", "expired", "revoked"]);
export const assuranceReviewStateEnum = pgEnum("assurance_review_state", ["open", "cleared", "confirmed"]);
export const activationRiskKindEnum = pgEnum("activation_risk_kind", ["early_refund", "repeated_customer", "dormant_account", "chargeback", "coordinated_cluster"]);
export const assuranceSeverityEnum = pgEnum("assurance_severity", ["warning", "high", "critical"]);
export const vendorAuditStateEnum = pgEnum("vendor_audit_state", ["pending", "passed", "failed"]);
export const biometricEvaluationKindEnum = pgEnum("biometric_evaluation_kind", ["pad", "injection", "deepfake", "demographic"]);
export const biometricEvaluationStateEnum = pgEnum("biometric_evaluation_state", ["approved", "rejected", "expired"]);

export const enrollmentAttestations = pgTable("enrollment_attestations", {
  id: serial("id").primaryKey(),
  caseRef: varchar("case_ref", { length: 48 }).notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  campusId: integer("campus_id").notNull().references(() => campuses.id),
  providerMode: integrationModeEnum("provider_mode").notNull().default("sandbox"),
  providerName: varchar("provider_name", { length: 80 }).notNull(),
  attestationHash: varchar("attestation_hash", { length: 64 }).notNull().unique(),
  academicTerm: varchar("academic_term", { length: 40 }).notNull(),
  verificationMethod: varchar("verification_method", { length: 40 }).notNull(),
  state: enrollmentAttestationStateEnum("state").notNull().default("submitted"),
  requestedValidUntil: timestamp("requested_valid_until", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: varchar("review_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("enrollment_attestation_user_state_idx").on(t.userId, t.state, t.validUntil), index("enrollment_attestation_expiry_idx").on(t.state, t.validUntil)]);

export const identityLinkages = pgTable("identity_linkages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  providerName: varchar("provider_name", { length: 80 }).notNull(),
  providerMode: integrationModeEnum("provider_mode").notNull().default("sandbox"),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("identity_linkage_provider_token_user_unique").on(t.providerName, t.tokenHash, t.userId), index("identity_linkage_token_idx").on(t.tokenHash, t.providerName)]);

export const duplicateIdentityCases = pgTable("duplicate_identity_cases", {
  id: serial("id").primaryKey(),
  caseRef: varchar("case_ref", { length: 48 }).notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  matchedUserId: integer("matched_user_id").notNull().references(() => users.id),
  linkageTokenHash: varchar("linkage_token_hash", { length: 64 }).notNull(),
  providerName: varchar("provider_name", { length: 80 }).notNull(),
  state: assuranceReviewStateEnum("state").notNull().default("open"),
  fraudCaseId: integer("fraud_case_id").references(() => fraudCases.id),
  matchedFraudCaseId: integer("matched_fraud_case_id").references(() => fraudCases.id),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: varchar("review_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("duplicate_identity_pair_token_unique").on(t.userId, t.matchedUserId, t.linkageTokenHash), index("duplicate_identity_user_state_idx").on(t.userId, t.state), index("duplicate_identity_matched_state_idx").on(t.matchedUserId, t.state)]);

export const activationRiskCases = pgTable("activation_risk_cases", {
  id: serial("id").primaryKey(),
  caseRef: varchar("case_ref", { length: 48 }).notNull().unique(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  repId: integer("rep_id").notNull().references(() => reps.id),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  kind: activationRiskKindEnum("kind").notNull(),
  severity: assuranceSeverityEnum("severity").notNull(),
  state: assuranceReviewStateEnum("state").notNull().default("open"),
  evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
  signalCount: integer("signal_count").notNull().default(1),
  fraudCaseId: integer("fraud_case_id").references(() => fraudCases.id),
  firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull().defaultNow(),
  lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: varchar("review_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("activation_risk_deal_kind_evidence_unique").on(t.dealId, t.kind, t.evidenceHash), index("activation_risk_rep_state_idx").on(t.repId, t.state), index("activation_risk_vendor_state_idx").on(t.vendorId, t.state)]);

export const vendorAssuranceAudits = pgTable("vendor_assurance_audits", {
  id: serial("id").primaryKey(),
  auditRef: varchar("audit_ref", { length: 48 }).notNull().unique(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  sampleSize: integer("sample_size").notNull(),
  verifiedOutcomes: integer("verified_outcomes").notNull(),
  mismatches: integer("mismatches").notNull(),
  state: vendorAuditStateEnum("state").notNull().default("pending"),
  evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id),
  reviewReason: varchar("review_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("vendor_assurance_vendor_state_idx").on(t.vendorId, t.state, t.createdAt)]);

export const biometricEvaluations = pgTable("biometric_evaluations", {
  id: serial("id").primaryKey(),
  evaluationRef: varchar("evaluation_ref", { length: 48 }).notNull().unique(),
  providerName: varchar("provider_name", { length: 80 }).notNull(),
  providerMode: integrationModeEnum("provider_mode").notNull().default("sandbox"),
  kind: biometricEvaluationKindEnum("kind").notNull(),
  modelVersion: varchar("model_version", { length: 100 }).notNull(),
  evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
  state: biometricEvaluationStateEnum("state").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  reviewerUserId: integer("reviewer_user_id").notNull().references(() => users.id),
  reviewReason: varchar("review_reason", { length: 500 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("biometric_evaluation_evidence_unique").on(t.providerName, t.modelVersion, t.kind, t.evidenceHash), index("biometric_evaluation_current_idx").on(t.providerName, t.modelVersion, t.kind, t.state, t.validUntil)]);

export const assuranceEvents = pgTable("assurance_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  caseType: varchar("case_type", { length: 40 }).notNull(),
  caseId: integer("case_id").notNull(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  fromState: varchar("from_state", { length: 40 }),
  toState: varchar("to_state", { length: 40 }),
  payload: json("payload").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("assurance_event_case_idx").on(t.caseType, t.caseId, t.createdAt)]);

// Phase 17: evidence-led platform intelligence. These records are decision
// evidence and simulations; they never replace the append-only financial ledger.
export const activationEvidenceNodes = pgTable("activation_evidence_nodes", {
  id: serial("id").primaryKey(),
  nodeRef: varchar("node_ref", { length: 48 }).notNull().unique(),
  dealId: integer("deal_id").references(() => deals.id),
  kind: varchar("kind", { length: 60 }).notNull(),
  source: varchar("source", { length: 100 }).notNull(),
  evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  metadataJson: json("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  recordedByUserId: integer("recorded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("activation_evidence_source_hash_unique").on(t.source, t.evidenceHash), index("activation_evidence_deal_idx").on(t.dealId, t.observedAt)]);

export const activationEvidenceEdges = pgTable("activation_evidence_edges", {
  id: serial("id").primaryKey(),
  fromNodeId: integer("from_node_id").notNull().references(() => activationEvidenceNodes.id),
  toNodeId: integer("to_node_id").notNull().references(() => activationEvidenceNodes.id),
  relationship: varchar("relationship", { length: 60 }).notNull(),
  rationale: varchar("rationale", { length: 500 }).notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("activation_evidence_edge_unique").on(t.fromNodeId, t.toNodeId, t.relationship)]);

export const promotionSimulations = pgTable("promotion_simulations", {
  id: serial("id").primaryKey(),
  simulationRef: varchar("simulation_ref", { length: 48 }).notNull().unique(),
  promotionId: integer("promotion_id").references(() => vendorPromotions.id),
  name: varchar("name", { length: 160 }).notNull(),
  assumptionsJson: json("assumptions_json").$type<Record<string, number>>().notNull(),
  resultsJson: json("results_json").$type<Record<string, number | string | boolean>>().notNull(),
  modelVersion: varchar("model_version", { length: 40 }).notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("promotion_simulation_promotion_idx").on(t.promotionId, t.createdAt)]);

export const metricDefinitions = pgTable("metric_definitions", {
  id: serial("id").primaryKey(),
  metricKey: varchar("metric_key", { length: 80 }).notNull(),
  version: integer("version").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  formula: text("formula").notNull(),
  sourceContract: text("source_contract").notNull(),
  state: varchar("state", { length: 30 }).notNull().default("draft"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  publishedByUserId: integer("published_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [uniqueIndex("metric_definition_version_unique").on(t.metricKey, t.version)]);

export const metricSnapshots = pgTable("metric_snapshots", {
  id: serial("id").primaryKey(),
  snapshotRef: varchar("snapshot_ref", { length: 48 }).notNull().unique(),
  definitionId: integer("definition_id").notNull().references(() => metricDefinitions.id),
  scopeType: varchar("scope_type", { length: 40 }).notNull(),
  scopeId: integer("scope_id").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  valueNumerator: bigint("value_numerator", { mode: "number" }).notNull(),
  valueDenominator: bigint("value_denominator", { mode: "number" }).notNull(),
  inputCount: integer("input_count").notNull(),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  explanation: text("explanation").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("metric_snapshot_reproducible_unique").on(t.definitionId, t.scopeType, t.scopeId, t.periodStart, t.periodEnd, t.sourceHash), index("metric_snapshot_scope_idx").on(t.scopeType, t.scopeId, t.periodEnd)]);

export const purposePolicies = pgTable("purpose_policies", {
  id: serial("id").primaryKey(),
  purpose: varchar("purpose", { length: 100 }).notNull(),
  version: integer("version").notNull(),
  notice: text("notice").notNull(),
  noticeHash: varchar("notice_hash", { length: 64 }).notNull(),
  retentionDays: integer("retention_days").notNull(),
  active: boolean("active").notNull().default(false),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("purpose_policy_version_unique").on(t.purpose, t.version), index("purpose_policy_active_idx").on(t.purpose, t.active)]);

export const universalConsents = pgTable("universal_consents", {
  id: serial("id").primaryKey(),
  subjectTokenHash: varchar("subject_token_hash", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 100 }).notNull(),
  policyId: integer("policy_id").notNull().references(() => purposePolicies.id),
  state: varchar("state", { length: 30 }).notNull(),
  evidenceRef: varchar("evidence_ref", { length: 160 }).notNull(),
  capturedByUserId: integer("captured_by_user_id").references(() => users.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("universal_consent_lookup_idx").on(t.subjectTokenHash, t.purpose, t.state, t.expiresAt), index("universal_consent_policy_idx").on(t.policyId, t.createdAt)]);

export const purposeAccessEvents = pgTable("purpose_access_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subjectTokenHash: varchar("subject_token_hash", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 100 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  decision: varchar("decision", { length: 30 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("purpose_access_subject_idx").on(t.subjectTokenHash, t.purpose, t.createdAt), index("purpose_access_decision_idx").on(t.decision, t.createdAt)]);

export const controlDefinitions = pgTable("control_definitions", {
  id: serial("id").primaryKey(),
  controlKey: varchar("control_key", { length: 80 }).notNull(),
  version: integer("version").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  triggerEvent: varchar("trigger_event", { length: 100 }).notNull(),
  conditionsJson: json("conditions_json").$type<Array<{ field: string; operator: string; value: string | number | boolean }>>().notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("draft"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  publishedByUserId: integer("published_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [uniqueIndex("control_definition_version_unique").on(t.controlKey, t.version), index("control_definition_trigger_idx").on(t.triggerEvent, t.state)]);

export const controlRuns = pgTable("control_runs", {
  id: serial("id").primaryKey(),
  runRef: varchar("run_ref", { length: 48 }).notNull().unique(),
  controlId: integer("control_id").notNull().references(() => controlDefinitions.id),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  matched: boolean("matched").notNull(),
  decision: varchar("decision", { length: 80 }).notNull(),
  explanation: text("explanation").notNull(),
  mode: varchar("mode", { length: 30 }).notNull().default("simulation"),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("control_run_control_idx").on(t.controlId, t.createdAt), index("control_run_decision_idx").on(t.decision, t.createdAt)]);

export const independentOutcomeObservations = pgTable("independent_outcome_observations", {
  id: serial("id").primaryKey(),
  observationRef: varchar("observation_ref", { length: 48 }).notNull().unique(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  observer: varchar("observer", { length: 100 }).notNull(),
  outcome: varchar("outcome", { length: 60 }).notNull(),
  evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  reconciliationState: varchar("reconciliation_state", { length: 40 }).notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewReason: varchar("review_reason", { length: 500 }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("independent_outcome_evidence_unique").on(t.dealId, t.observer, t.evidenceHash), index("independent_outcome_review_idx").on(t.reconciliationState, t.observedAt)]);

export const repCapabilityEvidence = pgTable("rep_capability_evidence", {
  id: serial("id").primaryKey(),
  repId: integer("rep_id").notNull().references(() => reps.id),
  capability: varchar("capability", { length: 80 }).notNull(),
  level: integer("level").notNull(),
  evidenceType: varchar("evidence_type", { length: 60 }).notNull(),
  evidenceRef: varchar("evidence_ref", { length: 120 }).notNull(),
  assessorUserId: integer("assessor_user_id").references(() => users.id),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("rep_capability_evidence_unique").on(t.repId, t.capability, t.evidenceType, t.evidenceRef), index("rep_capability_idx").on(t.repId, t.capability, t.observedAt)]);

export const coachingRecommendations = pgTable("coaching_recommendations", {
  id: serial("id").primaryKey(),
  repId: integer("rep_id").notNull().references(() => reps.id),
  capability: varchar("capability", { length: 80 }).notNull(),
  recommendation: text("recommendation").notNull(),
  rationale: text("rationale").notNull(),
  modelVersion: varchar("model_version", { length: 40 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("open"),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("coaching_rep_state_idx").on(t.repId, t.state, t.createdAt)]);

export const benchmarkSnapshots = pgTable("benchmark_snapshots", {
  id: serial("id").primaryKey(),
  snapshotRef: varchar("snapshot_ref", { length: 48 }).notNull().unique(),
  scopeType: varchar("scope_type", { length: 30 }).notNull(),
  metricKey: varchar("metric_key", { length: 80 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  minimumCohort: integer("minimum_cohort").notNull(),
  cellsJson: json("cells_json").$type<Array<{ key: string; cohort: number; numerator: number; denominator: number; suppressed: boolean }>>().notNull(),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("benchmark_scope_period_idx").on(t.scopeType, t.metricKey, t.periodEnd)]);

export const riskTimingAssessments = pgTable("risk_timing_assessments", {
  id: serial("id").primaryKey(),
  assessmentRef: varchar("assessment_ref", { length: 48 }).notNull().unique(),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  score: integer("score").notNull(),
  reasonsJson: json("reasons_json").$type<string[]>().notNull(),
  recommendedReviewHours: integer("recommended_review_hours").notNull(),
  recommendedPayoutDelayHours: integer("recommended_payout_delay_hours").notNull(),
  policyVersion: varchar("policy_version", { length: 40 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("recommended"),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id),
  decisionReason: varchar("decision_reason", { length: 500 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("risk_timing_deal_idx").on(t.dealId, t.createdAt), index("risk_timing_state_idx").on(t.state, t.createdAt)]);

export const providerProfiles = pgTable("provider_profiles", {
  id: serial("id").primaryKey(),
  providerKey: varchar("provider_key", { length: 80 }).notNull().unique(),
  capability: varchar("capability", { length: 80 }).notNull(),
  mode: varchar("mode", { length: 30 }).notNull().default("sandbox"),
  portabilityTier: varchar("portability_tier", { length: 40 }).notNull(),
  configHash: varchar("config_hash", { length: 64 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("provider_capability_idx").on(t.capability, t.active, t.mode)]);

export const resilienceDrills = pgTable("resilience_drills", {
  id: serial("id").primaryKey(),
  drillRef: varchar("drill_ref", { length: 48 }).notNull().unique(),
  providerId: integer("provider_id").notNull().references(() => providerProfiles.id),
  scenario: varchar("scenario", { length: 80 }).notNull(),
  checksJson: json("checks_json").$type<Array<{ name: string; passed: boolean; detail: string }>>().notNull(),
  recoverySeconds: integer("recovery_seconds").notNull(),
  state: varchar("state", { length: 30 }).notNull(),
  mode: varchar("mode", { length: 30 }).notNull().default("simulation"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("resilience_provider_idx").on(t.providerId, t.createdAt)]);

export const portabilityManifests = pgTable("portability_manifests", {
  id: serial("id").primaryKey(),
  manifestRef: varchar("manifest_ref", { length: 48 }).notNull().unique(),
  providerId: integer("provider_id").notNull().references(() => providerProfiles.id),
  schemaVersion: varchar("schema_version", { length: 40 }).notNull(),
  artifactCount: integer("artifact_count").notNull(),
  manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
  redactionsJson: json("redactions_json").$type<string[]>().notNull(),
  verificationState: varchar("verification_state", { length: 30 }).notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("portability_provider_idx").on(t.providerId, t.createdAt)]);

// Phase 17 CRM: planning, consent and human decisions stay separate from
// vendor-verified activation outcomes and commission entitlement.
export const crmRecommendations = pgTable("crm_recommendations", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  actionType: varchar("action_type", { length: 60 }).notNull(),
  recommendation: text("recommendation").notNull(),
  reasonsJson: json("reasons_json").$type<string[]>().notNull(),
  priority: integer("priority").notNull(),
  modelVersion: varchar("model_version", { length: 40 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("open"),
  feedback: varchar("feedback", { length: 500 }),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_recommendation_opportunity_idx").on(t.opportunityId, t.state, t.createdAt)]);

export const crmScorecards = pgTable("crm_scorecards", {
  id: serial("id").primaryKey(),
  scorecardKey: varchar("scorecard_key", { length: 80 }).notNull(),
  version: integer("version").notNull(),
  weightsJson: json("weights_json").$type<Record<string, number>>().notNull(),
  active: boolean("active").notNull().default(false),
  rationale: text("rationale").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_scorecard_version_unique").on(t.scorecardKey, t.version), index("crm_scorecard_active_idx").on(t.scorecardKey, t.active)]);

export const crmForecastScenarios = pgTable("crm_forecast_scenarios", {
  id: serial("id").primaryKey(),
  forecastRef: varchar("forecast_ref", { length: 48 }).notNull().unique(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 160 }).notNull(),
  scenario: varchar("scenario", { length: 30 }).notNull(),
  assumptionsJson: json("assumptions_json").$type<Record<string, number>>().notNull(),
  amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
  opportunityCount: integer("opportunity_count").notNull(),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_forecast_owner_idx").on(t.ownerUserId, t.scenario, t.createdAt)]);

export const crmSequences = pgTable("crm_sequences", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  name: varchar("name", { length: 160 }).notNull(),
  purpose: varchar("purpose", { length: 100 }).notNull(),
  subjectTokenHash: varchar("subject_token_hash", { length: 64 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("draft"),
  currentStep: integer("current_step").notNull().default(0),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_sequence_opportunity_idx").on(t.opportunityId, t.state, t.updatedAt)]);

export const crmSequenceSteps = pgTable("crm_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => crmSequences.id),
  stepNumber: integer("step_number").notNull(),
  channel: varchar("channel", { length: 30 }).notNull(),
  body: text("body").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("pending"),
  deliveryMode: varchar("delivery_mode", { length: 30 }).notNull().default("sandbox_simulation"),
  completedByUserId: integer("completed_by_user_id").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  receiptHash: varchar("receipt_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_sequence_step_unique").on(t.sequenceId, t.stepNumber), index("crm_sequence_step_due_idx").on(t.state, t.dueAt)]);

export const crmCollaborationNotes = pgTable("crm_collaboration_notes", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  visibility: varchar("visibility", { length: 30 }).notNull().default("team"),
  mentionedUserIds: json("mentioned_user_ids").$type<number[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_collaboration_opportunity_idx").on(t.opportunityId, t.createdAt)]);

export const crmDuplicateReviews = pgTable("crm_duplicate_reviews", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  matchedOpportunityId: integer("matched_opportunity_id").notNull().references(() => opportunities.id),
  matchType: varchar("match_type", { length: 60 }).notNull(),
  confidence: integer("confidence").notNull(),
  state: varchar("state", { length: 30 }).notNull().default("open"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  reviewReason: varchar("review_reason", { length: 500 }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_duplicate_pair_unique").on(t.opportunityId, t.matchedOpportunityId), index("crm_duplicate_state_idx").on(t.state, t.createdAt)]);

export const crmInfluenceTouchpoints = pgTable("crm_influence_touchpoints", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  promotionId: integer("promotion_id").references(() => vendorPromotions.id),
  touchType: varchar("touch_type", { length: 60 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  evidenceRef: varchar("evidence_ref", { length: 120 }).notNull(),
  financialAttributionChanged: boolean("financial_attribution_changed").notNull().default(false),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_influence_evidence_unique").on(t.opportunityId, t.touchType, t.evidenceRef), index("crm_influence_promotion_idx").on(t.promotionId, t.occurredAt)]);

export const crmRoutingRules = pgTable("crm_routing_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  campusId: integer("campus_id").references(() => campuses.id),
  productId: integer("product_id").references(() => products.id),
  maxOpenOpportunities: integer("max_open_opportunities").notNull(),
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_routing_match_idx").on(t.active, t.campusId, t.productId, t.priority)]);

export const crmRoutingDecisions = pgTable("crm_routing_decisions", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  ruleId: integer("rule_id").references(() => crmRoutingRules.id),
  proposedRepId: integer("proposed_rep_id").references(() => reps.id),
  workload: integer("workload").notNull(),
  reasonsJson: json("reasons_json").$type<string[]>().notNull(),
  state: varchar("state", { length: 30 }).notNull().default("proposed"),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_routing_opportunity_idx").on(t.opportunityId, t.state, t.createdAt)]);

export const crmFeedback = pgTable("crm_feedback", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  category: varchar("category", { length: 60 }).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  source: varchar("source", { length: 60 }).notNull(),
  consentEventId: bigint("consent_event_id", { mode: "number" }).references(() => purposeAccessEvents.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_feedback_opportunity_idx").on(t.opportunityId, t.category, t.createdAt)]);

// Phase 17 case management: reviewed evidence, deterministic assistance and
// support analytics cannot modify financial state.
export const caseChannelIntakes = pgTable("case_channel_intakes", {
  id: serial("id").primaryKey(),
  intakeRef: varchar("intake_ref", { length: 48 }).notNull().unique(),
  channel: varchar("channel", { length: 30 }).notNull(),
  externalIdHash: varchar("external_id_hash", { length: 64 }).notNull(),
  ticketId: integer("ticket_id").references(() => supportTickets.id),
  state: varchar("state", { length: 30 }).notNull(),
  mode: varchar("mode", { length: 30 }).notNull().default("sandbox_simulation"),
  reason: varchar("reason", { length: 500 }).notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_channel_external_unique").on(t.channel, t.externalIdHash), index("case_channel_ticket_idx").on(t.ticketId, t.createdAt)]);

export const caseRoutingRules = pgTable("case_routing_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  category: varchar("category", { length: 80 }),
  vendorId: integer("vendor_id").references(() => vendors.id),
  skill: varchar("skill", { length: 80 }).notNull(),
  maxOpenCases: integer("max_open_cases").notNull(),
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_routing_match_idx").on(t.active, t.category, t.vendorId, t.priority)]);

export const caseRoutingDecisions = pgTable("case_routing_decisions", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  ruleId: integer("rule_id").references(() => caseRoutingRules.id),
  proposedUserId: integer("proposed_user_id").references(() => users.id),
  workload: integer("workload").notNull(),
  reasonsJson: json("reasons_json").$type<string[]>().notNull(),
  state: varchar("state", { length: 30 }).notNull().default("proposed"),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_routing_ticket_idx").on(t.ticketId, t.state, t.createdAt)]);

export const caseSlaPolicies = pgTable("case_sla_policies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  priority: varchar("priority", { length: 30 }).notNull(),
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes").notNull(),
  timezone: varchar("timezone", { length: 60 }).notNull().default("Africa/Lagos"),
  businessStartMinute: integer("business_start_minute").notNull().default(480),
  businessEndMinute: integer("business_end_minute").notNull().default(1020),
  businessDays: json("business_days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_sla_policy_idx").on(t.priority, t.active)]);

export const caseSlaIntervals = pgTable("case_sla_intervals", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  kind: varchar("kind", { length: 30 }).notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_sla_interval_ticket_idx").on(t.ticketId, t.kind, t.startedAt), index("case_sla_interval_open_idx").on(t.endedAt, t.kind)]);

export const caseAttachments = pgTable("case_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  messageId: integer("message_id").references(() => caseMessages.id),
  objectKey: varchar("object_key", { length: 600 }).notNull().unique(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  contentType: varchar("content_type", { length: 160 }).notNull(),
  size: integer("size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  reviewStatus: varchar("review_status", { length: 40 }).notNull(),
  visibility: varchar("visibility", { length: 30 }).notNull(),
  uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => users.id),
  deletedByUserId: integer("deleted_by_user_id").references(() => users.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_attachment_ticket_idx").on(t.ticketId, t.createdAt), index("case_attachment_uploader_idx").on(t.uploadedByUserId, t.createdAt)]);

export const knowledgeArticles = pgTable("knowledge_articles", {
  id: serial("id").primaryKey(),
  articleKey: varchar("article_key", { length: 80 }).notNull(),
  version: integer("version").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  body: text("body").notNull(),
  keywords: json("keywords").$type<string[]>().notNull().default([]),
  state: varchar("state", { length: 30 }).notNull().default("draft"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, (t) => [uniqueIndex("knowledge_article_version_unique").on(t.articleKey, t.version), index("knowledge_article_search_idx").on(t.state, t.category)]);

export const caseKnowledgeLinks = pgTable("case_knowledge_links", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  articleId: integer("article_id").notNull().references(() => knowledgeArticles.id),
  helpful: boolean("helpful"),
  linkedByUserId: integer("linked_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_knowledge_link_unique").on(t.ticketId, t.articleId), index("case_knowledge_article_idx").on(t.articleId, t.helpful)]);

export const problemRecords = pgTable("problem_records", {
  id: serial("id").primaryKey(),
  problemRef: varchar("problem_ref", { length: 48 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("investigating"),
  rootCause: text("root_cause"),
  workaround: text("workaround"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("problem_state_idx").on(t.state, t.updatedAt)]);

export const problemCaseLinks = pgTable("problem_case_links", {
  id: serial("id").primaryKey(),
  problemId: integer("problem_id").notNull().references(() => problemRecords.id),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("problem_case_unique").on(t.problemId, t.ticketId), index("problem_case_ticket_idx").on(t.ticketId)]);

export const majorIncidents = pgTable("major_incidents", {
  id: serial("id").primaryKey(),
  incidentRef: varchar("incident_ref", { length: 48 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("investigating"),
  commanderUserId: integer("commander_user_id").notNull().references(() => users.id),
  problemId: integer("problem_id").references(() => problemRecords.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("major_incident_state_idx").on(t.state, t.severity, t.updatedAt)]);

export const incidentUpdates = pgTable("incident_updates", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => majorIncidents.id),
  updateType: varchar("update_type", { length: 40 }).notNull(),
  body: text("body").notNull(),
  visibility: varchar("visibility", { length: 30 }).notNull().default("internal"),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("incident_update_timeline_idx").on(t.incidentId, t.createdAt)]);

export const caseQualityReviews = pgTable("case_quality_reviews", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  reviewerUserId: integer("reviewer_user_id").notNull().references(() => users.id),
  rubricVersion: varchar("rubric_version", { length: 40 }).notNull(),
  scoresJson: json("scores_json").$type<Record<string, number>>().notNull(),
  totalScore: integer("total_score").notNull(),
  coachingNote: text("coaching_note").notNull(),
  state: varchar("state", { length: 30 }).notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_quality_ticket_idx").on(t.ticketId, t.createdAt), index("case_quality_reviewer_idx").on(t.reviewerUserId, t.createdAt)]);

export const caseExperienceSurveys = pgTable("case_experience_surveys", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  respondentTokenHash: varchar("respondent_token_hash", { length: 64 }).notNull(),
  csat: integer("csat").notNull(),
  effort: integer("effort").notNull(),
  comment: varchar("comment", { length: 1000 }),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_experience_respondent_unique").on(t.ticketId, t.respondentTokenHash), index("case_experience_created_idx").on(t.createdAt)]);

export const caseCopilotRuns = pgTable("case_copilot_runs", {
  id: serial("id").primaryKey(),
  runRef: varchar("run_ref", { length: 48 }).notNull().unique(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  summary: text("summary").notNull(),
  redactionsJson: json("redactions_json").$type<string[]>().notNull(),
  suggestedActionsJson: json("suggested_actions_json").$type<string[]>().notNull(),
  modelVersion: varchar("model_version", { length: 40 }).notNull(),
  state: varchar("state", { length: 30 }).notNull().default("proposed"),
  acceptedByUserId: integer("accepted_by_user_id").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("case_copilot_ticket_idx").on(t.ticketId, t.createdAt), index("case_copilot_state_idx").on(t.state, t.createdAt)]);

export const caseAgentSkills = pgTable("case_agent_skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  skill: varchar("skill", { length: 80 }).notNull(),
  level: integer("level").notNull(),
  active: boolean("active").notNull().default(true),
  assessedByUserId: integer("assessed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("case_agent_skill_unique").on(t.userId, t.skill), index("case_agent_skill_lookup_idx").on(t.skill, t.active, t.level)]);
