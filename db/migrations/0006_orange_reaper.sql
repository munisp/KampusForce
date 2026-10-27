CREATE TYPE "public"."fraud_case_reason" AS ENUM('activation_velocity', 'operations_review');--> statement-breakpoint
CREATE TYPE "public"."fraud_case_state" AS ENUM('open', 'released', 'upheld', 'appeal_open');--> statement-breakpoint
CREATE TYPE "public"."fraud_conduct_action" AS ENUM('none', 'strike', 'suspension');--> statement-breakpoint
CREATE TYPE "public"."fraud_hold_state" AS ENUM('active', 'released', 'upheld');--> statement-breakpoint
CREATE TABLE "activation_velocity_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"cap" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" varchar(80) NOT NULL,
	"from_state" "fraud_case_state",
	"to_state" "fraud_case_state",
	"note" text,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_ref" varchar(40) NOT NULL,
	"rep_id" integer NOT NULL,
	"reason" "fraud_case_reason" NOT NULL,
	"state" "fraud_case_state" DEFAULT 'open' NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"source_key" varchar(180),
	"review_due_at" timestamp with time zone NOT NULL,
	"evidence_json" json DEFAULT '{}'::json NOT NULL,
	"opened_by_user_id" integer,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"conduct_action" "fraud_conduct_action" DEFAULT 'none' NOT NULL,
	"prior_rep_status" "rep_status",
	"appeal_note" text,
	"appeal_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_cases_case_ref_unique" UNIQUE("case_ref"),
	CONSTRAINT "fraud_cases_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "fraud_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"state" "fraud_hold_state" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "fraud_holds_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
ALTER TABLE "commission_rule_drafts" ADD COLUMN "activation_cap_per_rep_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD COLUMN "activation_cap_per_rep_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "activation_velocity_buckets" ADD CONSTRAINT "activation_velocity_buckets_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_case_events" ADD CONSTRAINT "fraud_case_events_case_id_fraud_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_case_events" ADD CONSTRAINT "fraud_case_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD CONSTRAINT "fraud_cases_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD CONSTRAINT "fraud_cases_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_cases" ADD CONSTRAINT "fraud_cases_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_holds" ADD CONSTRAINT "fraud_holds_case_id_fraud_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_holds" ADD CONSTRAINT "fraud_holds_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activation_velocity_rep_window_unique" ON "activation_velocity_buckets" USING btree ("rep_id","window_start");--> statement-breakpoint
CREATE INDEX "activation_velocity_window_idx" ON "activation_velocity_buckets" USING btree ("window_start","rep_id");--> statement-breakpoint
CREATE INDEX "fraud_case_event_idx" ON "fraud_case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "fraud_case_rep_state_idx" ON "fraud_cases" USING btree ("rep_id","state");--> statement-breakpoint
CREATE INDEX "fraud_case_review_due_idx" ON "fraud_cases" USING btree ("state","review_due_at");--> statement-breakpoint
CREATE INDEX "fraud_case_source_idx" ON "fraud_cases" USING btree ("source_key","created_at");--> statement-breakpoint
CREATE INDEX "fraud_hold_rep_state_idx" ON "fraud_holds" USING btree ("rep_id","state");--> statement-breakpoint
CREATE TRIGGER "fraud_case_events_append_only"
BEFORE UPDATE OR DELETE ON "fraud_case_events"
FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();