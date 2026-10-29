CREATE TABLE "applicants" (
	"id" serial PRIMARY KEY NOT NULL,
	"applicant_ref" varchar(64) NOT NULL,
	"vendor_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"full_name" varchar(180) NOT NULL,
	"email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"phone_e164" varchar(20),
	"course" varchar(160) NOT NULL,
	"study_level" varchar(60) NOT NULL,
	"graduation_year" integer NOT NULL,
	"consent_version" varchar(60) NOT NULL,
	"consent_purpose" varchar(80) DEFAULT 'campus_opportunity_application' NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"consent_withdrawn_at" timestamp with time zone,
	"retention_until" timestamp with time zone NOT NULL,
	"anonymized_at" timestamp with time zone,
	"source_rep_id" integer,
	"owner_user_id" integer,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicants_applicant_ref_unique" UNIQUE("applicant_ref")
);
--> statement-breakpoint
CREATE TABLE "talent_application_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"document_type" varchar(30) NOT NULL,
	"object_key" varchar(600) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(160) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"review_status" varchar(40) NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by_user_id" integer,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "talent_application_documents_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "talent_application_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"actor_user_id" integer,
	"event_type" varchar(60) NOT NULL,
	"from_stage" varchar(30),
	"to_stage" varchar(30),
	"note" text NOT NULL,
	"metadata_json" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_ref" varchar(64) NOT NULL,
	"campaign_id" integer NOT NULL,
	"applicant_id" integer NOT NULL,
	"current_stage" varchar(30) DEFAULT 'submitted' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"score" integer,
	"decision_reason" text,
	"owner_user_id" integer,
	"source_rep_id" integer,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "talent_applications_application_ref_unique" UNIQUE("application_ref")
);
--> statement-breakpoint
CREATE TABLE "talent_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"kind" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"questions_json" json NOT NULL,
	"responses_json" json DEFAULT '{}'::json NOT NULL,
	"max_score" integer NOT NULL,
	"score" integer,
	"state" varchar(30) DEFAULT 'pending' NOT NULL,
	"rubric_note" text,
	"created_by_user_id" integer NOT NULL,
	"submitted_by_user_id" integer,
	"reviewed_by_user_id" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_campaign_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"target_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_ref" varchar(64) NOT NULL,
	"vendor_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"campaign_type" varchar(40) NOT NULL,
	"summary" text NOT NULL,
	"target_count" integer NOT NULL,
	"eligible_courses" json DEFAULT '[]'::json NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"reviewed_by_user_id" integer,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_campaigns_campaign_ref_unique" UNIQUE("campaign_ref")
);
--> statement-breakpoint
CREATE TABLE "talent_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_ref" varchar(64) NOT NULL,
	"campaign_id" integer NOT NULL,
	"rows_received" integer NOT NULL,
	"rows_created" integer NOT NULL,
	"duplicates_rejected" integer NOT NULL,
	"errors_json" json DEFAULT '[]'::json NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_import_batches_import_ref_unique" UNIQUE("import_ref")
);
--> statement-breakpoint
CREATE TABLE "talent_integration_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_ref" varchar(64) NOT NULL,
	"campaign_id" integer NOT NULL,
	"destination" varchar(40) NOT NULL,
	"format" varchar(20) NOT NULL,
	"row_count" integer NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"external_execution" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_integration_receipts_receipt_ref_unique" UNIQUE("receipt_ref")
);
--> statement-breakpoint
CREATE TABLE "talent_interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"mode" varchar(30) NOT NULL,
	"location" varchar(500) NOT NULL,
	"interviewer_user_id" integer NOT NULL,
	"state" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"scorecard_json" json,
	"recommendation" varchar(30),
	"notes" text,
	"created_by_user_id" integer NOT NULL,
	"completed_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "talent_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_ref" varchar(64) NOT NULL,
	"application_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"terms_summary" text NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"acceptance_token_hash" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"issued_by_user_id" integer,
	"issued_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"response_channel" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_offers_offer_ref_unique" UNIQUE("offer_ref")
);
--> statement-breakpoint
CREATE TABLE "talent_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"outcome_type" varchar(40) NOT NULL,
	"state" varchar(30) DEFAULT 'verified' NOT NULL,
	"evidence_note" text NOT NULL,
	"observed_by_user_id" integer NOT NULL,
	"reviewed_by_user_id" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_source_rep_id_reps_id_fk" FOREIGN KEY ("source_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_application_documents" ADD CONSTRAINT "talent_application_documents_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_application_documents" ADD CONSTRAINT "talent_application_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_application_documents" ADD CONSTRAINT "talent_application_documents_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_application_events" ADD CONSTRAINT "talent_application_events_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_application_events" ADD CONSTRAINT "talent_application_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_applications_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_applications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_applications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_applications_source_rep_id_reps_id_fk" FOREIGN KEY ("source_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_assessments" ADD CONSTRAINT "talent_assessments_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_assessments" ADD CONSTRAINT "talent_assessments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_assessments" ADD CONSTRAINT "talent_assessments_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_assessments" ADD CONSTRAINT "talent_assessments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_campaign_targets" ADD CONSTRAINT "talent_campaign_targets_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_campaign_targets" ADD CONSTRAINT "talent_campaign_targets_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_campaigns" ADD CONSTRAINT "talent_campaigns_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_campaigns" ADD CONSTRAINT "talent_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_campaigns" ADD CONSTRAINT "talent_campaigns_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_import_batches" ADD CONSTRAINT "talent_import_batches_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_import_batches" ADD CONSTRAINT "talent_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_integration_receipts" ADD CONSTRAINT "talent_integration_receipts_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_integration_receipts" ADD CONSTRAINT "talent_integration_receipts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_interviews" ADD CONSTRAINT "talent_interviews_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_interviews" ADD CONSTRAINT "talent_interviews_interviewer_user_id_users_id_fk" FOREIGN KEY ("interviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_interviews" ADD CONSTRAINT "talent_interviews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_interviews" ADD CONSTRAINT "talent_interviews_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_outcomes" ADD CONSTRAINT "talent_outcomes_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_outcomes" ADD CONSTRAINT "talent_outcomes_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_outcomes" ADD CONSTRAINT "talent_outcomes_observed_by_user_id_users_id_fk" FOREIGN KEY ("observed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_outcomes" ADD CONSTRAINT "talent_outcomes_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applicant_vendor_email_unique" ON "applicants" USING btree ("vendor_id","normalized_email");--> statement-breakpoint
CREATE INDEX "applicant_scope_idx" ON "applicants" USING btree ("vendor_id","campus_id","source_rep_id");--> statement-breakpoint
CREATE INDEX "applicant_retention_idx" ON "applicants" USING btree ("retention_until","anonymized_at");--> statement-breakpoint
CREATE INDEX "talent_document_application_idx" ON "talent_application_documents" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "talent_document_retention_idx" ON "talent_application_documents" USING btree ("purged_at","deleted_at");--> statement-breakpoint
CREATE INDEX "talent_application_event_idx" ON "talent_application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_application_unique" ON "talent_applications" USING btree ("campaign_id","applicant_id");--> statement-breakpoint
CREATE INDEX "talent_application_pipeline_idx" ON "talent_applications" USING btree ("campaign_id","current_stage","updated_at");--> statement-breakpoint
CREATE INDEX "talent_application_rep_idx" ON "talent_applications" USING btree ("source_rep_id","current_stage");--> statement-breakpoint
CREATE INDEX "talent_assessment_application_idx" ON "talent_assessments" USING btree ("application_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_campaign_campus_unique" ON "talent_campaign_targets" USING btree ("campaign_id","campus_id");--> statement-breakpoint
CREATE INDEX "talent_target_campus_idx" ON "talent_campaign_targets" USING btree ("campus_id","campaign_id");--> statement-breakpoint
CREATE INDEX "talent_campaign_scope_idx" ON "talent_campaigns" USING btree ("vendor_id","state","campaign_type");--> statement-breakpoint
CREATE INDEX "talent_campaign_window_idx" ON "talent_campaigns" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "talent_import_campaign_idx" ON "talent_import_batches" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "talent_integration_campaign_idx" ON "talent_integration_receipts" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "talent_interview_application_idx" ON "talent_interviews" USING btree ("application_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "talent_interviewer_schedule_idx" ON "talent_interviews" USING btree ("interviewer_user_id","state","scheduled_at");--> statement-breakpoint
CREATE INDEX "talent_offer_application_idx" ON "talent_offers" USING btree ("application_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_offer_token_unique" ON "talent_offers" USING btree ("acceptance_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_outcome_unique" ON "talent_outcomes" USING btree ("application_id","outcome_type");--> statement-breakpoint
CREATE INDEX "talent_outcome_campaign_idx" ON "talent_outcomes" USING btree ("campaign_id","state","outcome_type");--> statement-breakpoint
ALTER TABLE "talent_campaigns" ADD CONSTRAINT "talent_campaign_type_check" CHECK ("campaign_type" IN ('recruitment','internship','scholarship','fellowship','campus_event','research','training','waitlist'));--> statement-breakpoint
ALTER TABLE "talent_campaigns" ADD CONSTRAINT "talent_campaign_target_check" CHECK ("target_count" BETWEEN 1 AND 100000);--> statement-breakpoint
ALTER TABLE "talent_campaigns" ADD CONSTRAINT "talent_campaign_window_check" CHECK ("ends_at" > "starts_at");--> statement-breakpoint
ALTER TABLE "talent_campaign_targets" ADD CONSTRAINT "talent_target_count_check" CHECK ("target_count" BETWEEN 1 AND 100000);--> statement-breakpoint
ALTER TABLE "talent_applications" ADD CONSTRAINT "talent_application_stage_check" CHECK ("current_stage" IN ('submitted','screening','assessment','interview','offer','accepted','completed','rejected','withdrawn'));--> statement-breakpoint
ALTER TABLE "talent_application_documents" ADD CONSTRAINT "talent_document_type_check" CHECK ("document_type" IN ('cv','transcript','course_document','certificate','other'));--> statement-breakpoint
ALTER TABLE "talent_assessments" ADD CONSTRAINT "talent_assessment_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= "max_score"));--> statement-breakpoint
ALTER TABLE "talent_interviews" ADD CONSTRAINT "talent_interview_duration_check" CHECK ("duration_minutes" BETWEEN 15 AND 240);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "phase18_immutable_talent_event"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'talent application events are append-only'; END; $$;--> statement-breakpoint
CREATE TRIGGER "talent_application_events_no_update" BEFORE UPDATE ON "talent_application_events" FOR EACH ROW EXECUTE FUNCTION "phase18_immutable_talent_event"();--> statement-breakpoint
CREATE TRIGGER "talent_application_events_no_delete" BEFORE DELETE ON "talent_application_events" FOR EACH ROW EXECUTE FUNCTION "phase18_immutable_talent_event"();