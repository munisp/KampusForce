CREATE TYPE "public"."payout_attempt_state" AS ENUM('initiated', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_state" AS ENUM('pending', 'matched', 'within_tolerance', 'variance');--> statement-breakpoint
CREATE TABLE "payout_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"payout_id" integer NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_ref" varchar(100) NOT NULL,
	"state" "payout_attempt_state" DEFAULT 'initiated' NOT NULL,
	"failure_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payout_attempts_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" varchar(64) NOT NULL,
	"actor_user_id" integer NOT NULL,
	"ledger_kobo" bigint NOT NULL,
	"provider_kobo" bigint NOT NULL,
	"bank_kobo" bigint NOT NULL,
	"variance_kobo" bigint NOT NULL,
	"state" "reconciliation_state" NOT NULL,
	"evidence" varchar(40) DEFAULT 'sandbox_records' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "payout_id" integer;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "last_failure_code" varchar(120);--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_attempt_number_unique" ON "payout_attempts" USING btree ("payout_id","attempt_no");--> statement-breakpoint
CREATE INDEX "payout_attempt_payout_idx" ON "payout_attempts" USING btree ("payout_id","state");--> statement-breakpoint
CREATE INDEX "reconciliation_batch_idx" ON "reconciliation_runs" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE INDEX "deals_payout_idx" ON "deals" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "payout_dispatch_idx" ON "payouts" USING btree ("state","next_retry_at");--> statement-breakpoint
CREATE INDEX "payout_batch_idx" ON "payouts" USING btree ("batch_id");
--> statement-breakpoint
INSERT INTO "payout_attempts" ("payout_id", "attempt_no", "provider", "provider_ref", "state", "created_at", "completed_at")
SELECT "id", 1, "provider", "provider_ref", 'succeeded', "created_at", COALESCE("paid_at", "updated_at")
FROM "payouts"
WHERE "state" = 'paid'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "payouts" SET "attempts" = GREATEST("attempts", 1) WHERE "state" = 'paid';--> statement-breakpoint
CREATE TRIGGER "reconciliation_runs_append_only" BEFORE UPDATE OR DELETE ON "reconciliation_runs" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();
