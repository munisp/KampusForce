CREATE TYPE "public"."identity_case_state" AS ENUM('draft', 'submitted', 'processing', 'needs_more_info', 'manual_review', 'approved', 'rejected', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."identity_case_type" AS ENUM('representative_kyc', 'campus_lead_kyc', 'vendor_kyb', 'operations_kyc', 'customer_handoff');--> statement-breakpoint
CREATE TYPE "public"."identity_event_export_state" AS ENUM('pending', 'exported', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."identity_evidence_kind" AS ENUM('document_ocr', 'document_structure', 'vlm_extraction', 'registry_kyb', 'bank_name_match', 'liveness', 'deepfake', 'face_match', 'capture_integrity', 'reviewer_attestation');--> statement-breakpoint
CREATE TYPE "public"."identity_evidence_state" AS ENUM('recorded', 'passed', 'failed', 'review_required', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."identity_review_decision" AS ENUM('approve', 'request_info', 'reject', 'revoke');--> statement-breakpoint
CREATE TYPE "public"."identity_subject_type" AS ENUM('user', 'vendor', 'customer_handoff');--> statement-breakpoint
CREATE TABLE "identity_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_ref" varchar(48) NOT NULL,
	"case_type" "identity_case_type" NOT NULL,
	"subject_type" "identity_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"requested_by_user_id" integer,
	"vendor_id" integer,
	"campus_id" integer,
	"state" "identity_case_state" DEFAULT 'draft' NOT NULL,
	"provider_mode" "integration_mode" DEFAULT 'sandbox' NOT NULL,
	"policy_version" varchar(40) DEFAULT 'identity-v1' NOT NULL,
	"risk_level" varchar(20) DEFAULT 'standard' NOT NULL,
	"trigger_event" varchar(100) NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" integer,
	"decision_reason" varchar(500),
	"review_due_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_cases_case_ref_unique" UNIQUE("case_ref")
);
--> statement-breakpoint
CREATE TABLE "identity_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"subject_user_id" integer,
	"purpose" varchar(100) NOT NULL,
	"notice_version" varchar(40) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"notice_hash" varchar(64) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_evidence_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"kind" "identity_evidence_kind" NOT NULL,
	"provider" varchar(80) NOT NULL,
	"provider_reference_hash" varchar(64),
	"model_version" varchar(100),
	"state" "identity_evidence_state" NOT NULL,
	"score" numeric(7, 6),
	"threshold" numeric(7, 6),
	"quality_flags" json DEFAULT '[]'::json NOT NULL,
	"findings" json DEFAULT '{}'::json NOT NULL,
	"input_sha256" varchar(64),
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_lifecycle_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" varchar(36) NOT NULL,
	"case_id" integer,
	"event_type" varchar(100) NOT NULL,
	"subject_type" "identity_subject_type" NOT NULL,
	"subject_token" varchar(64) NOT NULL,
	"case_type" "identity_case_type" NOT NULL,
	"case_state" "identity_case_state" NOT NULL,
	"provider_mode" "integration_mode" NOT NULL,
	"payload" json DEFAULT '{}'::json NOT NULL,
	"export_state" "identity_event_export_state" DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	CONSTRAINT "identity_lifecycle_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "identity_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"actor_user_id" integer NOT NULL,
	"decision" "identity_review_decision" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"previous_state" "identity_case_state" NOT NULL,
	"resulting_state" "identity_case_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_cases" ADD CONSTRAINT "identity_cases_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_cases" ADD CONSTRAINT "identity_cases_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_cases" ADD CONSTRAINT "identity_cases_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_cases" ADD CONSTRAINT "identity_cases_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_consents" ADD CONSTRAINT "identity_consents_case_id_identity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."identity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_consents" ADD CONSTRAINT "identity_consents_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_evidence_metadata" ADD CONSTRAINT "identity_evidence_metadata_case_id_identity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."identity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_lifecycle_events" ADD CONSTRAINT "identity_lifecycle_events_case_id_identity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."identity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_reviews" ADD CONSTRAINT "identity_reviews_case_id_identity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."identity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_reviews" ADD CONSTRAINT "identity_reviews_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_case_subject_idx" ON "identity_cases" USING btree ("subject_type","subject_id","case_type","state");--> statement-breakpoint
CREATE INDEX "identity_case_review_idx" ON "identity_cases" USING btree ("state","review_due_at");--> statement-breakpoint
CREATE INDEX "identity_case_expiry_idx" ON "identity_cases" USING btree ("state","valid_until");--> statement-breakpoint
CREATE INDEX "identity_consent_case_idx" ON "identity_consents" USING btree ("case_id","purpose","withdrawn_at");--> statement-breakpoint
CREATE INDEX "identity_consent_subject_idx" ON "identity_consents" USING btree ("subject_user_id","withdrawn_at");--> statement-breakpoint
CREATE INDEX "identity_evidence_case_idx" ON "identity_evidence_metadata" USING btree ("case_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "identity_evidence_provider_idx" ON "identity_evidence_metadata" USING btree ("provider","state");--> statement-breakpoint
CREATE INDEX "identity_event_export_idx" ON "identity_lifecycle_events" USING btree ("export_state","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_event_subject_idx" ON "identity_lifecycle_events" USING btree ("subject_token","occurred_at");--> statement-breakpoint
CREATE INDEX "identity_review_case_idx" ON "identity_reviews" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_review_actor_idx" ON "identity_reviews" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE TRIGGER "identity_evidence_append_only" BEFORE UPDATE OR DELETE ON "identity_evidence_metadata" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "identity_reviews_append_only" BEFORE UPDATE OR DELETE ON "identity_reviews" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "kf_protect_identity_lifecycle_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'identity lifecycle events are append-only';
  END IF;
  IF (to_jsonb(NEW) - 'export_state' - 'exported_at') IS DISTINCT FROM (to_jsonb(OLD) - 'export_state' - 'exported_at') THEN
    RAISE EXCEPTION 'identity lifecycle content is immutable; only export bookkeeping may change';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_lifecycle_content_immutable" BEFORE UPDATE OR DELETE ON "identity_lifecycle_events" FOR EACH ROW EXECUTE FUNCTION "kf_protect_identity_lifecycle_event"();--> statement-breakpoint
CREATE UNIQUE INDEX "identity_one_open_case_per_subject" ON "identity_cases" USING btree ("case_type","subject_type","subject_id") WHERE "state" IN ('draft', 'submitted', 'processing', 'needs_more_info', 'manual_review');