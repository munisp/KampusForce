import {
  bigint,
  boolean,
  index,
  integer,
  json,
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
    firstTouchAt: timestamp("first_touch_at", { withTimezone: true }).notNull().defaultNow(),
    source: attributionSourceEnum("source").notNull(),
    tokenSig: varchar("token_sig", { length: 128 }).notNull(),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    status: attributionStatusEnum("status").notNull().default("active"),
  },
  (t) => [uniqueIndex("attribution_customer_vendor_unique").on(t.customerPhoneHash, t.vendorId)],
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
});

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
}, (t) => [uniqueIndex("campus_recruitment_token_unique").on(t.tokenHash), index("campus_recruitment_status_idx").on(t.status, t.expiresAt)]);

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

export type User = typeof users.$inferSelect;
export type Rep = typeof reps.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type VendorEvent = typeof vendorEvents.$inferSelect;
export type DsarRequest = typeof dsarRequests.$inferSelect;
export type BreachAssessment = typeof breachAssessments.$inferSelect;
export type FraudCase = typeof fraudCases.$inferSelect;
export type FraudHold = typeof fraudHolds.$inferSelect;
