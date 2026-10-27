CREATE TYPE "public"."breach_assessment_state" AS ENUM('reported', 'assessing', 'decision_recorded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."breach_notification_decision" AS ENUM('pending', 'not_required', 'required');--> statement-breakpoint
CREATE TYPE "public"."breach_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."dsar_request_type" AS ENUM('access', 'rectification', 'erasure', 'objection');--> statement-breakpoint
CREATE TYPE "public"."dsar_state" AS ENUM('received', 'identity_verified', 'in_review', 'fulfilled', 'rejected');--> statement-breakpoint
CREATE TABLE "breach_assessment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" varchar(80) NOT NULL,
	"from_state" "breach_assessment_state",
	"to_state" "breach_assessment_state",
	"note" text,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breach_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_ref" varchar(40) NOT NULL,
	"title" varchar(180) NOT NULL,
	"summary" text NOT NULL,
	"state" "breach_assessment_state" DEFAULT 'reported' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triage_due_at" timestamp with time zone NOT NULL,
	"risk" "breach_risk",
	"notification_decision" "breach_notification_decision" DEFAULT 'pending' NOT NULL,
	"notification_owner_user_id" integer,
	"decision_note" text,
	"decision_at" timestamp with time zone,
	"closure_note" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breach_assessments_assessment_ref_unique" UNIQUE("assessment_ref")
);
--> statement-breakpoint
CREATE TABLE "dsar_request_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" varchar(80) NOT NULL,
	"from_state" "dsar_state",
	"to_state" "dsar_state",
	"note" text,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dsar_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_ref" varchar(40) NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"request_type" "dsar_request_type" NOT NULL,
	"state" "dsar_state" DEFAULT 'received' NOT NULL,
	"owner_user_id" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"verified_by_user_id" integer,
	"verified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsar_requests_request_ref_unique" UNIQUE("request_ref")
);
--> statement-breakpoint
ALTER TABLE "breach_assessment_events" ADD CONSTRAINT "breach_assessment_events_assessment_id_breach_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."breach_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_assessment_events" ADD CONSTRAINT "breach_assessment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_assessments" ADD CONSTRAINT "breach_assessments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_assessments" ADD CONSTRAINT "breach_assessments_notification_owner_user_id_users_id_fk" FOREIGN KEY ("notification_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsar_request_events" ADD CONSTRAINT "dsar_request_events_request_id_dsar_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."dsar_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsar_request_events" ADD CONSTRAINT "dsar_request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsar_requests" ADD CONSTRAINT "dsar_requests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsar_requests" ADD CONSTRAINT "dsar_requests_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breach_assessment_event_idx" ON "breach_assessment_events" USING btree ("assessment_id","created_at");--> statement-breakpoint
CREATE INDEX "breach_assessment_state_due_idx" ON "breach_assessments" USING btree ("state","triage_due_at");--> statement-breakpoint
CREATE INDEX "dsar_request_event_idx" ON "dsar_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "dsar_customer_idx" ON "dsar_requests" USING btree ("customer_phone_hash","created_at");--> statement-breakpoint
CREATE INDEX "dsar_state_due_idx" ON "dsar_requests" USING btree ("state","due_at");--> statement-breakpoint
CREATE TRIGGER "dsar_request_events_append_only"
BEFORE UPDATE OR DELETE ON "dsar_request_events"
FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "breach_assessment_events_append_only"
BEFORE UPDATE OR DELETE ON "breach_assessment_events"
FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();