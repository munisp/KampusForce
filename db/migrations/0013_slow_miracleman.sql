CREATE TYPE "public"."activation_risk_kind" AS ENUM('early_refund', 'repeated_customer', 'dormant_account', 'chargeback', 'coordinated_cluster');--> statement-breakpoint
CREATE TYPE "public"."assurance_review_state" AS ENUM('open', 'cleared', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."assurance_severity" AS ENUM('warning', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."biometric_evaluation_kind" AS ENUM('pad', 'injection', 'deepfake', 'demographic');--> statement-breakpoint
CREATE TYPE "public"."biometric_evaluation_state" AS ENUM('approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."enrollment_attestation_state" AS ENUM('submitted', 'verified', 'rejected', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."vendor_audit_state" AS ENUM('pending', 'passed', 'failed');--> statement-breakpoint
CREATE TABLE "activation_risk_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_ref" varchar(48) NOT NULL,
	"deal_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"kind" "activation_risk_kind" NOT NULL,
	"severity" "assurance_severity" NOT NULL,
	"state" "assurance_review_state" DEFAULT 'open' NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"signal_count" integer DEFAULT 1 NOT NULL,
	"fraud_case_id" integer,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_risk_cases_case_ref_unique" UNIQUE("case_ref")
);
--> statement-breakpoint
CREATE TABLE "assurance_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_type" varchar(40) NOT NULL,
	"case_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" varchar(100) NOT NULL,
	"from_state" varchar(40),
	"to_state" varchar(40),
	"payload" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"evaluation_ref" varchar(48) NOT NULL,
	"provider_name" varchar(80) NOT NULL,
	"provider_mode" "integration_mode" DEFAULT 'sandbox' NOT NULL,
	"kind" "biometric_evaluation_kind" NOT NULL,
	"model_version" varchar(100) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"state" "biometric_evaluation_state" NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"reviewer_user_id" integer NOT NULL,
	"review_reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biometric_evaluations_evaluation_ref_unique" UNIQUE("evaluation_ref")
);
--> statement-breakpoint
CREATE TABLE "duplicate_identity_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_ref" varchar(48) NOT NULL,
	"user_id" integer NOT NULL,
	"matched_user_id" integer NOT NULL,
	"linkage_token_hash" varchar(64) NOT NULL,
	"provider_name" varchar(80) NOT NULL,
	"state" "assurance_review_state" DEFAULT 'open' NOT NULL,
	"fraud_case_id" integer,
	"matched_fraud_case_id" integer,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_identity_cases_case_ref_unique" UNIQUE("case_ref")
);
--> statement-breakpoint
CREATE TABLE "enrollment_attestations" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_ref" varchar(48) NOT NULL,
	"user_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"provider_mode" "integration_mode" DEFAULT 'sandbox' NOT NULL,
	"provider_name" varchar(80) NOT NULL,
	"attestation_hash" varchar(64) NOT NULL,
	"academic_term" varchar(40) NOT NULL,
	"verification_method" varchar(40) NOT NULL,
	"state" "enrollment_attestation_state" DEFAULT 'submitted' NOT NULL,
	"requested_valid_until" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_attestations_case_ref_unique" UNIQUE("case_ref"),
	CONSTRAINT "enrollment_attestations_attestation_hash_unique" UNIQUE("attestation_hash")
);
--> statement-breakpoint
CREATE TABLE "identity_linkages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_name" varchar(80) NOT NULL,
	"provider_mode" "integration_mode" DEFAULT 'sandbox' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_assurance_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_ref" varchar(48) NOT NULL,
	"vendor_id" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"sample_size" integer NOT NULL,
	"verified_outcomes" integer NOT NULL,
	"mismatches" integer NOT NULL,
	"state" "vendor_audit_state" DEFAULT 'pending' NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"reviewer_user_id" integer,
	"review_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_assurance_audits_audit_ref_unique" UNIQUE("audit_ref")
);
--> statement-breakpoint
ALTER TABLE "activation_risk_cases" ADD CONSTRAINT "activation_risk_cases_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_risk_cases" ADD CONSTRAINT "activation_risk_cases_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_risk_cases" ADD CONSTRAINT "activation_risk_cases_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_risk_cases" ADD CONSTRAINT "activation_risk_cases_fraud_case_id_fraud_cases_id_fk" FOREIGN KEY ("fraud_case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_risk_cases" ADD CONSTRAINT "activation_risk_cases_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_events" ADD CONSTRAINT "assurance_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_evaluations" ADD CONSTRAINT "biometric_evaluations_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_identity_cases" ADD CONSTRAINT "duplicate_identity_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_identity_cases" ADD CONSTRAINT "duplicate_identity_cases_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_identity_cases" ADD CONSTRAINT "duplicate_identity_cases_fraud_case_id_fraud_cases_id_fk" FOREIGN KEY ("fraud_case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_identity_cases" ADD CONSTRAINT "duplicate_identity_cases_matched_fraud_case_id_fraud_cases_id_fk" FOREIGN KEY ("matched_fraud_case_id") REFERENCES "public"."fraud_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_identity_cases" ADD CONSTRAINT "duplicate_identity_cases_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_attestations" ADD CONSTRAINT "enrollment_attestations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_attestations" ADD CONSTRAINT "enrollment_attestations_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_attestations" ADD CONSTRAINT "enrollment_attestations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_linkages" ADD CONSTRAINT "identity_linkages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_assurance_audits" ADD CONSTRAINT "vendor_assurance_audits_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_assurance_audits" ADD CONSTRAINT "vendor_assurance_audits_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activation_risk_deal_kind_evidence_unique" ON "activation_risk_cases" USING btree ("deal_id","kind","evidence_hash");--> statement-breakpoint
CREATE INDEX "activation_risk_rep_state_idx" ON "activation_risk_cases" USING btree ("rep_id","state");--> statement-breakpoint
CREATE INDEX "activation_risk_vendor_state_idx" ON "activation_risk_cases" USING btree ("vendor_id","state");--> statement-breakpoint
CREATE INDEX "assurance_event_case_idx" ON "assurance_events" USING btree ("case_type","case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "biometric_evaluation_evidence_unique" ON "biometric_evaluations" USING btree ("provider_name","model_version","kind","evidence_hash");--> statement-breakpoint
CREATE INDEX "biometric_evaluation_current_idx" ON "biometric_evaluations" USING btree ("provider_name","model_version","kind","state","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_identity_pair_token_unique" ON "duplicate_identity_cases" USING btree ("user_id","matched_user_id","linkage_token_hash");--> statement-breakpoint
CREATE INDEX "duplicate_identity_user_state_idx" ON "duplicate_identity_cases" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "duplicate_identity_matched_state_idx" ON "duplicate_identity_cases" USING btree ("matched_user_id","state");--> statement-breakpoint
CREATE INDEX "enrollment_attestation_user_state_idx" ON "enrollment_attestations" USING btree ("user_id","state","valid_until");--> statement-breakpoint
CREATE INDEX "enrollment_attestation_expiry_idx" ON "enrollment_attestations" USING btree ("state","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_linkage_provider_token_user_unique" ON "identity_linkages" USING btree ("provider_name","token_hash","user_id");--> statement-breakpoint
CREATE INDEX "identity_linkage_token_idx" ON "identity_linkages" USING btree ("token_hash","provider_name");--> statement-breakpoint
CREATE INDEX "vendor_assurance_vendor_state_idx" ON "vendor_assurance_audits" USING btree ("vendor_id","state","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_one_submitted_per_user" ON "enrollment_attestations" USING btree ("user_id") WHERE "state" = 'submitted';--> statement-breakpoint
ALTER TABLE "duplicate_identity_cases" ADD CONSTRAINT "duplicate_identity_distinct_users" CHECK ("user_id" <> "matched_user_id");--> statement-breakpoint
ALTER TABLE "activation_risk_cases" ADD CONSTRAINT "activation_risk_signal_count_positive" CHECK ("signal_count" > 0);--> statement-breakpoint
ALTER TABLE "vendor_assurance_audits" ADD CONSTRAINT "vendor_assurance_counts_valid" CHECK ("sample_size" > 0 AND "verified_outcomes" >= 0 AND "mismatches" >= 0 AND "verified_outcomes" + "mismatches" <= "sample_size");--> statement-breakpoint
ALTER TABLE "vendor_assurance_audits" ADD CONSTRAINT "vendor_assurance_period_valid" CHECK ("period_end" > "period_start");--> statement-breakpoint
CREATE TRIGGER "assurance_events_append_only" BEFORE UPDATE OR DELETE ON "assurance_events" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();
