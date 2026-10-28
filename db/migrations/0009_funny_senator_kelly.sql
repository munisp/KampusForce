CREATE TYPE "public"."rollout_evidence_source" AS ENUM('system_snapshot', 'external_evidence');--> statement-breakpoint
CREATE TYPE "public"."rollout_evidence_state" AS ENUM('recorded', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rollout_metric_unit" AS ENUM('count', 'percent', 'naira', 'months', 'kobo', 'ratio');--> statement-breakpoint
CREATE TYPE "public"."rollout_subject_type" AS ENUM('campus_cohort', 'phase_quarter');--> statement-breakpoint
CREATE TABLE "campus_cohorts" (
	"id" serial PRIMARY KEY NOT NULL,
	"campus_id" integer NOT NULL,
	"label" varchar(120) NOT NULL,
	"cohort_start_date" date NOT NULL,
	"month_one_end_date" date NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollout_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" "rollout_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"metric_key" varchar(100) NOT NULL,
	"source_type" "rollout_evidence_source" NOT NULL,
	"real_world_attested" boolean DEFAULT false NOT NULL,
	"state" "rollout_evidence_state" NOT NULL,
	"metric_value" numeric(24, 6) NOT NULL,
	"unit" "rollout_metric_unit" NOT NULL,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"evidence_reference" varchar(500) NOT NULL,
	"note" text NOT NULL,
	"submitted_by_user_id" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_reference" varchar(500),
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollout_evidence_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidence_id" integer NOT NULL,
	"actor_user_id" integer NOT NULL,
	"action" varchar(60) NOT NULL,
	"from_state" "rollout_evidence_state",
	"to_state" "rollout_evidence_state" NOT NULL,
	"note" text NOT NULL,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollout_quarters" (
	"id" serial PRIMARY KEY NOT NULL,
	"phase" integer NOT NULL,
	"label" varchar(120) NOT NULL,
	"quarter_start_date" date NOT NULL,
	"quarter_end_date" date NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campus_cohorts" ADD CONSTRAINT "campus_cohorts_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_cohorts" ADD CONSTRAINT "campus_cohorts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_evidence" ADD CONSTRAINT "rollout_evidence_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_evidence" ADD CONSTRAINT "rollout_evidence_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_evidence_events" ADD CONSTRAINT "rollout_evidence_events_evidence_id_rollout_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."rollout_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_evidence_events" ADD CONSTRAINT "rollout_evidence_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollout_quarters" ADD CONSTRAINT "rollout_quarters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campus_cohort_campus_label_unique" ON "campus_cohorts" USING btree ("campus_id","label");--> statement-breakpoint
CREATE INDEX "campus_cohort_period_idx" ON "campus_cohorts" USING btree ("campus_id","cohort_start_date","month_one_end_date");--> statement-breakpoint
CREATE INDEX "rollout_evidence_subject_metric_idx" ON "rollout_evidence" USING btree ("subject_type","subject_id","metric_key","submitted_at");--> statement-breakpoint
CREATE INDEX "rollout_evidence_review_idx" ON "rollout_evidence" USING btree ("state","source_type","reviewed_at");--> statement-breakpoint
CREATE INDEX "rollout_evidence_event_idx" ON "rollout_evidence_events" USING btree ("evidence_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rollout_quarter_phase_start_unique" ON "rollout_quarters" USING btree ("phase","quarter_start_date");--> statement-breakpoint
CREATE INDEX "rollout_quarter_phase_period_idx" ON "rollout_quarters" USING btree ("phase","quarter_start_date","quarter_end_date");--> statement-breakpoint
CREATE TRIGGER "campus_cohorts_append_only" BEFORE UPDATE OR DELETE ON "campus_cohorts" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "rollout_quarters_append_only" BEFORE UPDATE OR DELETE ON "rollout_quarters" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "rollout_evidence_events_append_only" BEFORE UPDATE OR DELETE ON "rollout_evidence_events" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE FUNCTION "kf_prevent_rollout_evidence_delete"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rollout evidence is append-only'; END; $$;--> statement-breakpoint
CREATE TRIGGER "rollout_evidence_no_delete" BEFORE DELETE ON "rollout_evidence" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_rollout_evidence_delete"();