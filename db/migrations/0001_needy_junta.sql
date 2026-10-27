CREATE TYPE "public"."job_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."recruitment_status" ADD VALUE 'accepted' BEFORE 'activated';--> statement-breakpoint
ALTER TYPE "public"."recruitment_status" ADD VALUE 'expired';--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_key" varchar(80) NOT NULL,
	"slot_key" varchar(100) NOT NULL,
	"trigger" varchar(20) DEFAULT 'manual' NOT NULL,
	"status" "job_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"result_json" json,
	"error" varchar(1000)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(180) NOT NULL,
	"body" varchar(1000) NOT NULL,
	"href" varchar(300),
	"entity_type" varchar(60),
	"entity_id" varchar(100),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "accepted_user_id" integer;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "activated_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "revoked_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_slot_unique" ON "job_runs" USING btree ("job_key","slot_key");--> statement-breakpoint
CREATE INDEX "job_run_started_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD CONSTRAINT "campus_recruitments_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD CONSTRAINT "campus_recruitments_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD CONSTRAINT "campus_recruitments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campus_recruitment_token_unique" ON "campus_recruitments" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "campus_recruitment_status_idx" ON "campus_recruitments" USING btree ("status","expires_at");
--> statement-breakpoint
UPDATE "campus_recruitments" SET
  "token_hash" = md5("id"::text || random()::text) || md5(random()::text || clock_timestamp()::text),
  "expires_at" = "invited_at" + interval '7 days'
WHERE "token_hash" IS NULL OR "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kf_prevent_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; corrections must be new records', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "deal_state_history_append_only" BEFORE UPDATE OR DELETE ON "deal_state_history" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "support_ticket_events_append_only" BEFORE UPDATE OR DELETE ON "support_ticket_events" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "consent_logs_append_only" BEFORE UPDATE OR DELETE ON "consent_logs" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();
