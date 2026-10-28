CREATE TYPE "public"."data_platform_run_state" AS ENUM('running', 'succeeded', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."financial_posting_state" AS ENUM('pending', 'submitting', 'submitted', 'reconciled', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."mojaloop_intent_state" AS ENUM('disabled', 'party_resolved', 'quoted', 'transfer_pending', 'settled', 'failed');--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_ref" varchar(64) NOT NULL,
	"window_days" integer NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload_json" json NOT NULL,
	"source_counts_json" json NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_snapshots_snapshot_ref_unique" UNIQUE("snapshot_ref")
);
--> statement-breakpoint
CREATE TABLE "data_platform_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_ref" varchar(80) NOT NULL,
	"layer" varchar(60) NOT NULL,
	"engine" varchar(60) NOT NULL,
	"mode" "integration_mode" DEFAULT 'sandbox' NOT NULL,
	"state" "data_platform_run_state" NOT NULL,
	"input_hash" varchar(64),
	"output_hash" varchar(64),
	"rows_processed" integer DEFAULT 0 NOT NULL,
	"quarantined_rows" integer DEFAULT 0 NOT NULL,
	"details_json" json DEFAULT '{}'::json NOT NULL,
	"deletion_evidence_json" json,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "data_platform_runs_run_ref_unique" UNIQUE("run_ref")
);
--> statement-breakpoint
CREATE TABLE "dataset_lineage" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset_key" varchar(100) NOT NULL,
	"version" integer NOT NULL,
	"source_datasets" json NOT NULL,
	"transform" text NOT NULL,
	"consent_policy" varchar(160) NOT NULL,
	"access_scope" varchar(160) NOT NULL,
	"output_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_posting_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_group" varchar(64) NOT NULL,
	"operation" varchar(40) NOT NULL,
	"payload_json" json NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"state" "financial_posting_state" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"external_batch_ref" varchar(100),
	"last_error_code" varchar(160),
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	CONSTRAINT "financial_posting_outbox_entry_group_unique" UNIQUE("entry_group")
);
--> statement-breakpoint
CREATE TABLE "mojaloop_rail_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"intent_ref" varchar(80) NOT NULL,
	"payout_id" integer,
	"idempotency_key" varchar(100) NOT NULL,
	"party_ref_hash" varchar(64) NOT NULL,
	"amount_net_kobo" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"state" "mojaloop_intent_state" DEFAULT 'disabled' NOT NULL,
	"quote_json" json,
	"transfer_ref" varchar(100),
	"last_error_code" varchar(160),
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_rail_intents_intent_ref_unique" UNIQUE("intent_ref"),
	CONSTRAINT "mojaloop_rail_intents_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "mojaloop_rail_intents_transfer_ref_unique" UNIQUE("transfer_ref")
);
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_rail_intents" ADD CONSTRAINT "mojaloop_rail_intents_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mojaloop_rail_intents" ADD CONSTRAINT "mojaloop_rail_intents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_snapshot_window_idx" ON "analytics_snapshots" USING btree ("window_days","created_at");--> statement-breakpoint
CREATE INDEX "analytics_snapshot_hash_idx" ON "analytics_snapshots" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "data_platform_run_layer_idx" ON "data_platform_runs" USING btree ("layer","started_at");--> statement-breakpoint
CREATE INDEX "data_platform_run_state_idx" ON "data_platform_runs" USING btree ("state","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_lineage_version_unique" ON "dataset_lineage" USING btree ("dataset_key","version");--> statement-breakpoint
CREATE INDEX "dataset_lineage_created_idx" ON "dataset_lineage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "financial_outbox_dispatch_idx" ON "financial_posting_outbox" USING btree ("state","next_retry_at","created_at");--> statement-breakpoint
CREATE INDEX "financial_outbox_external_idx" ON "financial_posting_outbox" USING btree ("external_batch_ref");--> statement-breakpoint
CREATE INDEX "mojaloop_intent_payout_idx" ON "mojaloop_rail_intents" USING btree ("payout_id","created_at");--> statement-breakpoint
CREATE INDEX "mojaloop_intent_state_idx" ON "mojaloop_rail_intents" USING btree ("state","updated_at");
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshot_window_allowed" CHECK ("window_days" IN (7, 30, 90, 365));--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshot_hash_shape" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "data_platform_runs" ADD CONSTRAINT "data_platform_rows_nonnegative" CHECK ("rows_processed" >= 0 AND "quarantined_rows" >= 0);--> statement-breakpoint
ALTER TABLE "financial_posting_outbox" ADD CONSTRAINT "financial_outbox_hash_shape" CHECK ("payload_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "financial_posting_outbox" ADD CONSTRAINT "financial_outbox_attempts_nonnegative" CHECK ("attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "financial_posting_outbox" ADD CONSTRAINT "financial_outbox_reconciled_evidence" CHECK ("state" <> 'reconciled' OR "reconciled_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "mojaloop_rail_intents" ADD CONSTRAINT "mojaloop_party_hash_shape" CHECK ("party_ref_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "mojaloop_rail_intents" ADD CONSTRAINT "mojaloop_amount_positive" CHECK ("amount_net_kobo" > 0);--> statement-breakpoint
ALTER TABLE "mojaloop_rail_intents" ADD CONSTRAINT "mojaloop_currency_ngn" CHECK ("currency" = 'NGN');--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
WITH "grouped" AS (
  SELECT
    "entry_group",
    json_build_object(
      'version', 1,
      'entries', json_agg(json_build_object('account', "account", 'direction', "direction", 'amountKobo', "amount_kobo") ORDER BY "id"),
      'accountRefs', json_build_object()
    ) AS "payload"
  FROM "ledger_entries"
  GROUP BY "entry_group"
)
INSERT INTO "financial_posting_outbox" ("entry_group", "operation", "payload_json", "payload_hash", "state", "last_error_code")
SELECT
  "entry_group",
  CASE
    WHEN "entry_group" LIKE 'confirm_%' THEN 'activation_confirmation'
    WHEN "entry_group" LIKE 'reverse_%' THEN 'activation_reversal'
    ELSE 'payout_settlement'
  END,
  "payload",
  encode(digest(convert_to("payload"::text, 'UTF8'), 'sha256'), 'hex'),
  'blocked',
  'backfill_requires_entity_scoped_opening_balance_proof'
FROM "grouped"
ON CONFLICT ("entry_group") DO NOTHING;--> statement-breakpoint
CREATE TRIGGER "analytics_snapshots_append_only" BEFORE UPDATE OR DELETE ON "analytics_snapshots" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "dataset_lineage_append_only" BEFORE UPDATE OR DELETE ON "dataset_lineage" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();