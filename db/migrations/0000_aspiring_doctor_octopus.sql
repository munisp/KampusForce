CREATE TYPE "public"."assisted_session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."attribution_source" AS ENUM('link', 'qr', 'assisted', 'claim');--> statement-breakpoint
CREATE TYPE "public"."attribution_status" AS ENUM('active', 'expired', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."campus_status" AS ENUM('planned', 'launching', 'live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."commission_basis" AS ENUM('flat', 'pct');--> statement-breakpoint
CREATE TYPE "public"."commission_trigger" AS ENUM('signup', 'kyc_complete', 'funded', 'first_transaction', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."deal_state" AS ENUM('pending', 'confirmed', 'payable', 'paid', 'disputed', 'void', 'clawed_back', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dispute_state" AS ENUM('open', 'reviewing', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_state" AS ENUM('unverified', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('rep_payable', 'lead_override_payable', 'platform_revenue', 'vendor_escrow', 'clawback_reserve', 'withholding_tax', 'external_bank');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."override_state" AS ENUM('accrued', 'paid', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payout_state" AS ENUM('queued', 'processing', 'paid', 'failed', 'held');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('fintech', 'airtime_data', 'devices', 'edtech', 'micro_insurance');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."recruitment_status" AS ENUM('invited', 'activated', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."rep_status" AS ENUM('pending', 'active', 'held', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."rep_tier" AS ENUM('starter', 'bronze', 'silver', 'gold', 'campus_lead');--> statement-breakpoint
CREATE TYPE "public"."rule_draft_state" AS ENUM('draft', 'published', 'expired');--> statement-breakpoint
CREATE TYPE "public"."support_priority" AS ENUM('normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_state" AS ENUM('rep_triage', 'campus_lead_queue', 'vendor_queue', 'ops_queue', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('rep', 'vendor', 'ops', 'finance', 'admin');--> statement-breakpoint
CREATE TYPE "public"."vendor_event_status" AS ENUM('processed', 'ignored', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."vendor_event_type" AS ENUM('account_created', 'kyc_complete', 'funded', 'first_transaction', 'renewal', 'refund');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('pending', 'active', 'paused');--> statement-breakpoint
CREATE TABLE "assisted_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" "assisted_session_status" DEFAULT 'active' NOT NULL,
	"consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"product_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"first_touch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "attribution_source" NOT NULL,
	"token_sig" varchar(128) NOT NULL,
	"claim_expires_at" timestamp with time zone,
	"status" "attribution_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(80) NOT NULL,
	"metadata_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "campus_lead_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_rep_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"assigned_by_user_id" integer,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campus_lead_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"lead_rep_id" integer NOT NULL,
	"source_rep_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"basis_points" integer DEFAULT 500 NOT NULL,
	"team_commission_kobo" bigint NOT NULL,
	"override_kobo" bigint NOT NULL,
	"platform_margin_kobo" bigint NOT NULL,
	"platform_margin_after_kobo" bigint NOT NULL,
	"state" "override_state" DEFAULT 'accrued' NOT NULL,
	"payout_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campus_recruitments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_rep_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"phone_e164" varchar(20) NOT NULL,
	"note" varchar(300),
	"status" "recruitment_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"state" varchar(80) NOT NULL,
	"status" "campus_status" DEFAULT 'planned' NOT NULL,
	"launch_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rule_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"basis" "commission_basis" NOT NULL,
	"pct_bps" integer,
	"flat_amount_kobo" bigint,
	"trigger_event" "commission_trigger" NOT NULL,
	"recurrence_months" integer DEFAULT 1 NOT NULL,
	"confirm_days" integer DEFAULT 30 NOT NULL,
	"clawback_days" integer DEFAULT 60 NOT NULL,
	"sample_amount_kobo" bigint,
	"vendor_commission_kobo" bigint NOT NULL,
	"rep_commission_kobo" bigint NOT NULL,
	"platform_fee_kobo" bigint NOT NULL,
	"state" "rule_draft_state" DEFAULT 'draft' NOT NULL,
	"published_rule_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"basis" "commission_basis" NOT NULL,
	"pct_bps" integer,
	"flat_amount_kobo" bigint,
	"trigger_event" "commission_trigger" NOT NULL,
	"recurrence_months" integer DEFAULT 1 NOT NULL,
	"confirm_days" integer DEFAULT 30 NOT NULL,
	"clawback_days" integer DEFAULT 60 NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consent_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"phone_hash" varchar(64) NOT NULL,
	"purpose" varchar(160) NOT NULL,
	"policy_version" varchar(30) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_state_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"from_state" varchar(30),
	"to_state" varchar(30) NOT NULL,
	"actor" varchar(100) NOT NULL,
	"reason" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"attribution_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"commission_rule_id" integer,
	"customer_phone_hash" varchar(64) NOT NULL,
	"trigger_event" varchar(40) NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"state" "deal_state" DEFAULT 'pending' NOT NULL,
	"vendor_commission_kobo" bigint NOT NULL,
	"rep_commission_kobo" bigint NOT NULL,
	"platform_fee_kobo" bigint NOT NULL,
	"confirm_at" timestamp with time zone NOT NULL,
	"clawback_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"opened_by" integer NOT NULL,
	"reason_code" varchar(80) NOT NULL,
	"evidence_json" json,
	"state" "dispute_state" DEFAULT 'open' NOT NULL,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "escrow_wallets" (
	"vendor_id" integer PRIMARY KEY NOT NULL,
	"balance_kobo" bigint DEFAULT 0 NOT NULL,
	"low_balance_threshold_kobo" bigint DEFAULT 10000000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer,
	"payout_id" integer,
	"account" "ledger_account" NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"entry_group" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_e164" varchar(20) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"amount_gross_kobo" bigint NOT NULL,
	"amount_net_kobo" bigint NOT NULL,
	"withholding_kobo" bigint DEFAULT 0 NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_ref" varchar(100) NOT NULL,
	"state" "payout_state" DEFAULT 'queued' NOT NULL,
	"batch_id" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payouts_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"vendor_ref" varchar(100) NOT NULL,
	"name" varchar(180) NOT NULL,
	"category" "product_category" NOT NULL,
	"description" text NOT NULL,
	"price_kobo" bigint DEFAULT 0 NOT NULL,
	"landing_url" varchar(500) NOT NULL,
	"pitch_script" text NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_vendor_ref_unique" UNIQUE("vendor_ref")
);
--> statement-breakpoint
CREATE TABLE "reps" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"code" varchar(32) NOT NULL,
	"tier" "rep_tier" DEFAULT 'starter' NOT NULL,
	"quality_score" integer DEFAULT 100 NOT NULL,
	"status" "rep_status" DEFAULT 'pending' NOT NULL,
	"contractor_agreement_signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reps_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "support_resolution_macros" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"approved_by_user_id" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"actor_user_id" integer,
	"actor_role" varchar(40) NOT NULL,
	"action" varchar(80) NOT NULL,
	"from_state" varchar(40),
	"to_state" varchar(40),
	"note" text,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_ref" varchar(40) NOT NULL,
	"rep_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"deal_id" integer,
	"category" varchar(80) NOT NULL,
	"subject" varchar(180) NOT NULL,
	"description" text NOT NULL,
	"priority" "support_priority" DEFAULT 'normal' NOT NULL,
	"state" "support_ticket_state" DEFAULT 'rep_triage' NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"sla_breached_at" timestamp with time zone,
	"resolution" text,
	"resolution_macro_id" integer,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"csat" integer,
	"csat_comment" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_ticket_ref_unique" UNIQUE("ticket_ref")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_e164" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"role" "user_role" DEFAULT 'rep' NOT NULL,
	"kyc_state" "kyc_state" DEFAULT 'unverified' NOT NULL,
	"nin_token" varchar(128),
	"nin_last4" varchar(4),
	"bank_name" varchar(120),
	"bank_code" varchar(12),
	"bank_account_last4" varchar(4),
	"bank_account_name" varchar(160),
	"bank_name_match" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "vendor_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"type" "vendor_event_type" NOT NULL,
	"customer_ref_hash" varchar(64) NOT NULL,
	"product_id" integer,
	"amount_kobo" bigint,
	"payload_json" json NOT NULL,
	"hmac_ok" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"status" "vendor_event_status" DEFAULT 'processed' NOT NULL,
	"quarantine_reason" varchar(300),
	CONSTRAINT "vendor_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"company_name" varchar(180) NOT NULL,
	"cac_number" varchar(40),
	"webhook_key" varchar(80) NOT NULL,
	"webhook_secret" varchar(128) NOT NULL,
	"status" "vendor_status" DEFAULT 'pending' NOT NULL,
	"support_sla_hours" integer DEFAULT 24 NOT NULL,
	"quality_score" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_webhook_key_unique" UNIQUE("webhook_key")
);
--> statement-breakpoint
ALTER TABLE "assisted_sessions" ADD CONSTRAINT "assisted_sessions_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assisted_sessions" ADD CONSTRAINT "assisted_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_records" ADD CONSTRAINT "attribution_records_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_records" ADD CONSTRAINT "attribution_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_records" ADD CONSTRAINT "attribution_records_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_assignments" ADD CONSTRAINT "campus_lead_assignments_lead_rep_id_reps_id_fk" FOREIGN KEY ("lead_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_assignments" ADD CONSTRAINT "campus_lead_assignments_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_assignments" ADD CONSTRAINT "campus_lead_assignments_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_assignments" ADD CONSTRAINT "campus_lead_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_overrides" ADD CONSTRAINT "campus_lead_overrides_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_overrides" ADD CONSTRAINT "campus_lead_overrides_lead_rep_id_reps_id_fk" FOREIGN KEY ("lead_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_overrides" ADD CONSTRAINT "campus_lead_overrides_source_rep_id_reps_id_fk" FOREIGN KEY ("source_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_lead_overrides" ADD CONSTRAINT "campus_lead_overrides_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD CONSTRAINT "campus_recruitments_lead_rep_id_reps_id_fk" FOREIGN KEY ("lead_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD CONSTRAINT "campus_recruitments_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_drafts" ADD CONSTRAINT "commission_rule_drafts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_drafts" ADD CONSTRAINT "commission_rule_drafts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_drafts" ADD CONSTRAINT "commission_rule_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_drafts" ADD CONSTRAINT "commission_rule_drafts_published_rule_id_commission_rules_id_fk" FOREIGN KEY ("published_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_state_history" ADD CONSTRAINT "deal_state_history_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_attribution_id_attribution_records_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."attribution_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_wallets" ADD CONSTRAINT "escrow_wallets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reps" ADD CONSTRAINT "reps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reps" ADD CONSTRAINT "reps_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_resolution_macros" ADD CONSTRAINT "support_resolution_macros_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_resolution_macros" ADD CONSTRAINT "support_resolution_macros_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_events" ADD CONSTRAINT "vendor_events_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_events" ADD CONSTRAINT "vendor_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_customer_vendor_unique" ON "attribution_records" USING btree ("customer_phone_hash","vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campus_lead_assignment_rep_unique" ON "campus_lead_assignments" USING btree ("rep_id");--> statement-breakpoint
CREATE INDEX "campus_lead_assignment_lead_idx" ON "campus_lead_assignments" USING btree ("lead_rep_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campus_lead_override_deal_unique" ON "campus_lead_overrides" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "campus_lead_override_lead_idx" ON "campus_lead_overrides" USING btree ("lead_rep_id","state");--> statement-breakpoint
CREATE INDEX "deals_rep_state_idx" ON "deals" USING btree ("rep_id","state");--> statement-breakpoint
CREATE INDEX "deals_confirm_idx" ON "deals" USING btree ("state","confirm_at");--> statement-breakpoint
CREATE INDEX "ledger_group_idx" ON "ledger_entries" USING btree ("entry_group");--> statement-breakpoint
CREATE INDEX "ledger_deal_idx" ON "ledger_entries" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "support_ticket_rep_idx" ON "support_tickets" USING btree ("rep_id","state");--> statement-breakpoint
CREATE INDEX "support_ticket_vendor_sla_idx" ON "support_tickets" USING btree ("vendor_id","state","sla_due_at");