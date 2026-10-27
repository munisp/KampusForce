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
export const recruitmentStatusEnum = pgEnum("recruitment_status", ["invited", "activated", "revoked"]);
export const overrideStateEnum = pgEnum("override_state", ["accrued", "paid", "reversed"]);
export const ledgerAccountEnum = pgEnum("ledger_account", ["rep_payable", "lead_override_payable", "platform_revenue", "vendor_escrow", "clawback_reserve", "withholding_tax", "external_bank"]);
export const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);
export const payoutStateEnum = pgEnum("payout_state", ["queued", "processing", "paid", "failed", "held"]);
export const assistedSessionStatusEnum = pgEnum("assisted_session_status", ["active", "completed", "abandoned"]);
export const disputeStateEnum = pgEnum("dispute_state", ["open", "reviewing", "resolved", "rejected"]);
export const supportPriorityEnum = pgEnum("support_priority", ["normal", "urgent"]);
export const supportTicketStateEnum = pgEnum("support_ticket_state", ["rep_triage", "campus_lead_queue", "vendor_queue", "ops_queue", "resolved", "closed"]);


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
    vendorCommissionKobo: bigint("vendor_commission_kobo", { mode: "number" }).notNull(),
    repCommissionKobo: bigint("rep_commission_kobo", { mode: "number" }).notNull(),
    platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }).notNull(),
    confirmAt: timestamp("confirm_at", { withTimezone: true }).notNull(),
    clawbackUntil: timestamp("clawback_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deals_rep_state_idx").on(t.repId, t.state), index("deals_confirm_idx").on(t.state, t.confirmAt)],
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
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

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
