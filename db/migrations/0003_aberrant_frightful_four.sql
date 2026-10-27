CREATE TABLE "rate_limit_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"policy" varchar(60) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "lead_previous_tier" "rep_tier";--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "lead_promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "lead_demoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "lead_demotion_reason" varchar(300);--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "lead_eligibility_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_policy_idx" ON "rate_limit_buckets" USING btree ("policy","window_started_at");