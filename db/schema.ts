import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const campuses = mysqlTable("campuses", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  state: varchar("state", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["planned", "launching", "live", "paused"]).notNull().default("planned"),
  launchDate: timestamp("launch_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  role: mysqlEnum("role", ["rep", "vendor", "ops", "finance", "admin"]).notNull().default("rep"),
  kycState: mysqlEnum("kyc_state", ["unverified", "pending", "verified", "rejected"]).notNull().default("unverified"),
  ninToken: varchar("nin_token", { length: 128 }),
  ninLast4: varchar("nin_last4", { length: 4 }),
  bankName: varchar("bank_name", { length: 120 }),
  bankCode: varchar("bank_code", { length: 12 }),
  bankAccountLast4: varchar("bank_account_last4", { length: 4 }),
  bankAccountName: varchar("bank_account_name", { length: 160 }),
  bankNameMatch: boolean("bank_name_match").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reps = mysqlTable("reps", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  campusId: bigint("campus_id", { mode: "number", unsigned: true }).notNull().references(() => campuses.id),
  code: varchar("code", { length: 32 }).notNull().unique(),
  tier: mysqlEnum("tier", ["starter", "bronze", "silver", "gold", "campus_lead"]).notNull().default("starter"),
  qualityScore: int("quality_score").notNull().default(100),
  status: mysqlEnum("status", ["pending", "active", "held", "suspended"]).notNull().default("pending"),
  contractorAgreementSignedAt: timestamp("contractor_agreement_signed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vendors = mysqlTable("vendors", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).references(() => users.id),
  companyName: varchar("company_name", { length: 180 }).notNull(),
  cacNumber: varchar("cac_number", { length: 40 }),
  webhookKey: varchar("webhook_key", { length: 80 }).notNull().unique(),
  webhookSecret: varchar("webhook_secret", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["pending", "active", "paused"]).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const products = mysqlTable("products", {
  id: serial("id").primaryKey(),
  vendorId: bigint("vendor_id", { mode: "number", unsigned: true }).notNull().references(() => vendors.id),
  vendorRef: varchar("vendor_ref", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  category: mysqlEnum("category", ["fintech", "airtime_data", "devices", "edtech", "micro_insurance"]).notNull(),
  description: text("description").notNull(),
  priceKobo: bigint("price_kobo", { mode: "number" }).notNull().default(0),
  landingUrl: varchar("landing_url", { length: 500 }).notNull(),
  pitchScript: text("pitch_script").notNull(),
  status: mysqlEnum("status", ["draft", "active", "paused"]).notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const commissionRules = mysqlTable("commission_rules", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  version: int("version").notNull().default(1),
  basis: mysqlEnum("basis", ["flat", "pct"]).notNull(),
  pctBps: int("pct_bps"),
  flatAmountKobo: bigint("flat_amount_kobo", { mode: "number" }),
  triggerEvent: mysqlEnum("trigger_event", ["signup", "kyc_complete", "funded", "first_transaction", "renewal"]).notNull(),
  recurrenceMonths: int("recurrence_months").notNull().default(1),
  confirmDays: int("confirm_days").notNull().default(30),
  clawbackDays: int("clawback_days").notNull().default(60),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  supersededAt: timestamp("superseded_at"),
});

export const attributionRecords = mysqlTable(
  "attribution_records",
  {
    id: serial("id").primaryKey(),
    repId: bigint("rep_id", { mode: "number", unsigned: true }).notNull().references(() => reps.id),
    customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
    productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
    vendorId: bigint("vendor_id", { mode: "number", unsigned: true }).notNull().references(() => vendors.id),
    firstTouchAt: timestamp("first_touch_at").notNull().defaultNow(),
    source: mysqlEnum("source", ["link", "qr", "assisted", "claim"]).notNull(),
    tokenSig: varchar("token_sig", { length: 128 }).notNull(),
    claimExpiresAt: timestamp("claim_expires_at"),
    status: mysqlEnum("status", ["active", "expired", "disputed"]).notNull().default("active"),
  },
  (t) => [uniqueIndex("attribution_customer_vendor_unique").on(t.customerPhoneHash, t.vendorId)],
);

export const vendorEvents = mysqlTable("vendor_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  vendorId: bigint("vendor_id", { mode: "number", unsigned: true }).notNull().references(() => vendors.id),
  type: mysqlEnum("type", ["account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]).notNull(),
  customerRefHash: varchar("customer_ref_hash", { length: 64 }).notNull(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).references(() => products.id),
  amountKobo: bigint("amount_kobo", { mode: "number" }),
  payloadJson: json("payload_json").notNull(),
  hmacOk: boolean("hmac_ok").notNull().default(false),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  dedupeKey: varchar("dedupe_key", { length: 160 }).notNull().unique(),
  status: mysqlEnum("status", ["processed", "ignored", "quarantined"]).notNull().default("processed"),
  quarantineReason: varchar("quarantine_reason", { length: 300 }),
});

export const deals = mysqlTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    attributionId: bigint("attribution_id", { mode: "number", unsigned: true }).notNull().references(() => attributionRecords.id),
    productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
    vendorId: bigint("vendor_id", { mode: "number", unsigned: true }).notNull().references(() => vendors.id),
    repId: bigint("rep_id", { mode: "number", unsigned: true }).notNull().references(() => reps.id),
    customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
    triggerEvent: varchar("trigger_event", { length: 40 }).notNull(),
    eventId: varchar("event_id", { length: 36 }).notNull().unique(),
    state: mysqlEnum("state", ["pending", "confirmed", "payable", "paid", "disputed", "void", "clawed_back", "failed"]).notNull().default("pending"),
    vendorCommissionKobo: bigint("vendor_commission_kobo", { mode: "number" }).notNull(),
    repCommissionKobo: bigint("rep_commission_kobo", { mode: "number" }).notNull(),
    platformFeeKobo: bigint("platform_fee_kobo", { mode: "number" }).notNull(),
    confirmAt: timestamp("confirm_at").notNull(),
    clawbackUntil: timestamp("clawback_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [index("deals_rep_state_idx").on(t.repId, t.state), index("deals_confirm_idx").on(t.state, t.confirmAt)],
);

export const dealStateHistory = mysqlTable("deal_state_history", {
  id: serial("id").primaryKey(),
  dealId: bigint("deal_id", { mode: "number", unsigned: true }).notNull().references(() => deals.id),
  fromState: varchar("from_state", { length: 30 }),
  toState: varchar("to_state", { length: 30 }).notNull(),
  actor: varchar("actor", { length: 100 }).notNull(),
  reason: varchar("reason", { length: 300 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ledgerEntries = mysqlTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    dealId: bigint("deal_id", { mode: "number", unsigned: true }).references(() => deals.id),
    payoutId: bigint("payout_id", { mode: "number", unsigned: true }),
    account: mysqlEnum("account", ["rep_payable", "platform_revenue", "vendor_escrow", "clawback_reserve", "withholding_tax", "external_bank"]).notNull(),
    direction: mysqlEnum("direction", ["debit", "credit"]).notNull(),
    amountKobo: bigint("amount_kobo", { mode: "number" }).notNull(),
    entryGroup: varchar("entry_group", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_group_idx").on(t.entryGroup), index("ledger_deal_idx").on(t.dealId)],
);

export const escrowWallets = mysqlTable("escrow_wallets", {
  vendorId: bigint("vendor_id", { mode: "number", unsigned: true }).primaryKey().references(() => vendors.id),
  balanceKobo: bigint("balance_kobo", { mode: "number" }).notNull().default(0),
  lowBalanceThresholdKobo: bigint("low_balance_threshold_kobo", { mode: "number" }).notNull().default(10000000),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const payouts = mysqlTable("payouts", {
  id: serial("id").primaryKey(),
  repId: bigint("rep_id", { mode: "number", unsigned: true }).notNull().references(() => reps.id),
  amountGrossKobo: bigint("amount_gross_kobo", { mode: "number" }).notNull(),
  amountNetKobo: bigint("amount_net_kobo", { mode: "number" }).notNull(),
  withholdingKobo: bigint("withholding_kobo", { mode: "number" }).notNull().default(0),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerRef: varchar("provider_ref", { length: 100 }).notNull().unique(),
  state: mysqlEnum("state", ["queued", "processing", "paid", "failed", "held"]).notNull().default("queued"),
  batchId: varchar("batch_id", { length: 64 }).notNull(),
  attempts: int("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
});

export const assistedSessions = mysqlTable("assisted_sessions", {
  id: serial("id").primaryKey(),
  repId: bigint("rep_id", { mode: "number", unsigned: true }).notNull().references(() => reps.id),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  customerPhoneHash: varchar("customer_phone_hash", { length: 64 }).notNull(),
  currentStep: int("current_step").notNull().default(1),
  status: mysqlEnum("status", ["active", "completed", "abandoned"]).notNull().default("active"),
  consentAt: timestamp("consent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const disputes = mysqlTable("disputes", {
  id: serial("id").primaryKey(),
  dealId: bigint("deal_id", { mode: "number", unsigned: true }).notNull().references(() => deals.id),
  openedBy: bigint("opened_by", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  reasonCode: varchar("reason_code", { length: 80 }).notNull(),
  evidenceJson: json("evidence_json"),
  state: mysqlEnum("state", ["open", "reviewing", "resolved", "rejected"]).notNull().default("open"),
  decision: text("decision"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  decidedAt: timestamp("decided_at"),
});

export const consentLogs = mysqlTable("consent_logs", {
  id: serial("id").primaryKey(),
  actorUserId: bigint("actor_user_id", { mode: "number", unsigned: true }).references(() => users.id),
  phoneHash: varchar("phone_hash", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 160 }).notNull(),
  policyVersion: varchar("policy_version", { length: 30 }).notNull(),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
});

export const auditLogs = mysqlTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorUserId: bigint("actor_user_id", { mode: "number", unsigned: true }).references(() => users.id),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: varchar("entity_id", { length: 80 }).notNull(),
  metadataJson: json("metadata_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const otpChallenges = mysqlTable("otp_challenges", {
  id: serial("id").primaryKey(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  verifiedAt: timestamp("verified_at"),
  attempts: int("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const authSessions = mysqlTable("auth_sessions", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Rep = typeof reps.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type VendorEvent = typeof vendorEvents.$inferSelect;
