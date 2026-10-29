CREATE TABLE "commission_recurrence_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"cycle_number" integer NOT NULL,
	"receipt_type" varchar(40) NOT NULL,
	"vendor_event_id" varchar(36),
	"deal_id" integer,
	"detail" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_recurrence_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_deal_id" integer NOT NULL,
	"last_deal_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"commission_rule_id" integer NOT NULL,
	"promotion_link_id" integer,
	"customer_phone_hash" varchar(64) NOT NULL,
	"customer_ref_hash" varchar(64) NOT NULL,
	"cycle_number" integer DEFAULT 1 NOT NULL,
	"max_cycles" integer NOT NULL,
	"interval_months" integer DEFAULT 1 NOT NULL,
	"next_due_at" timestamp with time zone,
	"state" varchar(40) DEFAULT 'scheduled' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_recurrence_schedules_original_deal_id_unique" UNIQUE("original_deal_id")
);
--> statement-breakpoint
CREATE TABLE "institutional_campaign_governance" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"sponsor_type" varchar(40) NOT NULL,
	"sponsor_name" varchar(200) NOT NULL,
	"sponsor_reference" varchar(160) NOT NULL,
	"funding_model" varchar(40) NOT NULL,
	"funding_reference" varchar(200) NOT NULL,
	"funding_currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"funding_amount_minor" bigint,
	"procurement_reference" varchar(200),
	"eligibility_policy" text NOT NULL,
	"eligible_study_levels" json DEFAULT '[]'::json NOT NULL,
	"minimum_graduation_year" integer,
	"maximum_graduation_year" integer,
	"safeguarding_policy" text NOT NULL,
	"accessibility_policy" text NOT NULL,
	"audit_requirements" text NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"submitted_by_user_id" integer,
	"reviewed_by_user_id" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutional_campaign_governance_campaign_id_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
CREATE TABLE "institutional_campaign_partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"normalized_name" varchar(220) NOT NULL,
	"institution_name" varchar(200) NOT NULL,
	"institution_type" varchar(40) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"partner_role" varchar(30) NOT NULL,
	"governance_reference" varchar(200) NOT NULL,
	"state" varchar(30) DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_document_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"consent_version" varchar(100) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"state" varchar(30) DEFAULT 'queued' NOT NULL,
	"processor_mode" varchar(30) NOT NULL,
	"providers_json" json DEFAULT '[]'::json NOT NULL,
	"extracted_fields_json" json DEFAULT '{}'::json NOT NULL,
	"confidence_bps" integer,
	"quality_flags_json" json DEFAULT '[]'::json NOT NULL,
	"provider_versions_json" json DEFAULT '{}'::json NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"raw_text_persisted" boolean DEFAULT false NOT NULL,
	"automated_decision" boolean DEFAULT false NOT NULL,
	"error_code" varchar(100),
	"requested_by_user_id" integer NOT NULL,
	"processed_at" timestamp with time zone,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"withdrawn_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_document_analyses_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_connector_progress_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"mapping_id" integer,
	"handoff_id" integer,
	"external_event_key_hash" varchar(64) NOT NULL,
	"stage" varchar(40) NOT NULL,
	"verification_state" varchar(30) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"vendor_event_id" varchar(36),
	"deal_id" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_external_customer_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"handoff_id" integer,
	"pseudonym_hash" varchar(64) NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"customer_ref_hash" varchar(64) NOT NULL,
	"first_touch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_onboarding_connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_ref" varchar(64) NOT NULL,
	"vendor_id" integer NOT NULL,
	"promotion_id" integer NOT NULL,
	"name" varchar(180) NOT NULL,
	"execution_mode" varchar(30) DEFAULT 'sandbox' NOT NULL,
	"handoff_mode" varchar(40) NOT NULL,
	"target_count" integer NOT NULL,
	"success_event" varchar(40) NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"external_account_creation" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_onboarding_connectors_connector_ref_unique" UNIQUE("connector_ref"),
	CONSTRAINT "vendor_onboarding_connectors_promotion_id_unique" UNIQUE("promotion_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_representative_handoffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"promotion_link_id" integer,
	"application_id" integer,
	"external_reference_hash" varchar(64) NOT NULL,
	"state" varchar(40) DEFAULT 'selected' NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"consent_version" varchar(100) NOT NULL,
	"provisioned_at" timestamp with time zone,
	"evidence_note" text,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_rule_drafts" ADD COLUMN "recurrence_interval_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD COLUMN "recurrence_interval_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_recurrence_receipts" ADD CONSTRAINT "commission_recurrence_receipts_schedule_id_commission_recurrence_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."commission_recurrence_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_receipts" ADD CONSTRAINT "commission_recurrence_receipts_vendor_event_id_vendor_events_id_fk" FOREIGN KEY ("vendor_event_id") REFERENCES "public"."vendor_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_receipts" ADD CONSTRAINT "commission_recurrence_receipts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_original_deal_id_deals_id_fk" FOREIGN KEY ("original_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_last_deal_id_deals_id_fk" FOREIGN KEY ("last_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_schedules_promotion_link_id_promotion_links_id_fk" FOREIGN KEY ("promotion_link_id") REFERENCES "public"."promotion_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_governance" ADD CONSTRAINT "institutional_campaign_governance_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_governance" ADD CONSTRAINT "institutional_campaign_governance_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_governance" ADD CONSTRAINT "institutional_campaign_governance_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_governance" ADD CONSTRAINT "institutional_campaign_governance_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_partners" ADD CONSTRAINT "institutional_campaign_partners_campaign_id_talent_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."talent_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_partners" ADD CONSTRAINT "institutional_campaign_partners_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutional_campaign_partners" ADD CONSTRAINT "institutional_campaign_partners_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_document_analyses_document_id_talent_application_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."talent_application_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_document_analyses_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_document_analyses_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_document_analyses_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_connector_progress_events" ADD CONSTRAINT "vendor_connector_progress_events_connector_id_vendor_onboarding_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."vendor_onboarding_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_connector_progress_events" ADD CONSTRAINT "vendor_connector_progress_events_mapping_id_vendor_external_customer_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."vendor_external_customer_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_connector_progress_events" ADD CONSTRAINT "vendor_connector_progress_events_handoff_id_vendor_representative_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."vendor_representative_handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_connector_progress_events" ADD CONSTRAINT "vendor_connector_progress_events_vendor_event_id_vendor_events_id_fk" FOREIGN KEY ("vendor_event_id") REFERENCES "public"."vendor_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_connector_progress_events" ADD CONSTRAINT "vendor_connector_progress_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_connector_progress_events" ADD CONSTRAINT "vendor_connector_progress_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_external_customer_mappings" ADD CONSTRAINT "vendor_external_customer_mappings_connector_id_vendor_onboarding_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."vendor_onboarding_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_external_customer_mappings" ADD CONSTRAINT "vendor_external_customer_mappings_handoff_id_vendor_representative_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."vendor_representative_handoffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_external_customer_mappings" ADD CONSTRAINT "vendor_external_customer_mappings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_onboarding_connectors" ADD CONSTRAINT "vendor_onboarding_connectors_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_onboarding_connectors" ADD CONSTRAINT "vendor_onboarding_connectors_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_onboarding_connectors" ADD CONSTRAINT "vendor_onboarding_connectors_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_onboarding_connectors" ADD CONSTRAINT "vendor_onboarding_connectors_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_representative_handoffs_connector_id_vendor_onboarding_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."vendor_onboarding_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_representative_handoffs_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_representative_handoffs_promotion_link_id_promotion_links_id_fk" FOREIGN KEY ("promotion_link_id") REFERENCES "public"."promotion_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_representative_handoffs_application_id_talent_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."talent_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_representative_handoffs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_representative_handoffs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_recurrence_receipt_unique" ON "commission_recurrence_receipts" USING btree ("schedule_id","cycle_number","receipt_type");--> statement-breakpoint
CREATE INDEX "commission_recurrence_receipt_deal_idx" ON "commission_recurrence_receipts" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "commission_recurrence_due_idx" ON "commission_recurrence_schedules" USING btree ("state","next_due_at");--> statement-breakpoint
CREATE INDEX "commission_recurrence_customer_idx" ON "commission_recurrence_schedules" USING btree ("vendor_id","product_id","customer_phone_hash");--> statement-breakpoint
CREATE INDEX "commission_recurrence_vendor_idx" ON "commission_recurrence_schedules" USING btree ("vendor_id","state");--> statement-breakpoint
CREATE INDEX "institutional_governance_state_idx" ON "institutional_campaign_governance" USING btree ("state","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "institutional_partner_unique" ON "institutional_campaign_partners" USING btree ("campaign_id","normalized_name");--> statement-breakpoint
CREATE INDEX "institutional_partner_state_idx" ON "institutional_campaign_partners" USING btree ("campaign_id","state");--> statement-breakpoint
CREATE INDEX "talent_analysis_application_idx" ON "talent_document_analyses" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "talent_analysis_retention_idx" ON "talent_document_analyses" USING btree ("retention_until","purged_at");--> statement-breakpoint
CREATE INDEX "talent_analysis_review_idx" ON "talent_document_analyses" USING btree ("state","processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_progress_event_unique" ON "vendor_connector_progress_events" USING btree ("connector_id","external_event_key_hash");--> statement-breakpoint
CREATE INDEX "vendor_progress_dashboard_idx" ON "vendor_connector_progress_events" USING btree ("connector_id","stage","verification_state");--> statement-breakpoint
CREATE INDEX "vendor_progress_mapping_idx" ON "vendor_connector_progress_events" USING btree ("mapping_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_customer_pseudonym_unique" ON "vendor_external_customer_mappings" USING btree ("connector_id","pseudonym_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_customer_phone_unique" ON "vendor_external_customer_mappings" USING btree ("connector_id","customer_phone_hash");--> statement-breakpoint
CREATE INDEX "vendor_customer_handoff_idx" ON "vendor_external_customer_mappings" USING btree ("handoff_id");--> statement-breakpoint
CREATE INDEX "vendor_connector_vendor_idx" ON "vendor_onboarding_connectors" USING btree ("vendor_id","state");--> statement-breakpoint
CREATE INDEX "vendor_connector_promotion_idx" ON "vendor_onboarding_connectors" USING btree ("promotion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_handoff_connector_rep_unique" ON "vendor_representative_handoffs" USING btree ("connector_id","rep_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_handoff_link_unique" ON "vendor_representative_handoffs" USING btree ("promotion_link_id");--> statement-breakpoint
CREATE INDEX "vendor_handoff_state_idx" ON "vendor_representative_handoffs" USING btree ("connector_id","state");--> statement-breakpoint
ALTER TABLE "institutional_campaign_governance" ADD CONSTRAINT "institutional_governance_state_check" CHECK ("state" IN ('draft','pending_review','approved','rejected'));
--> statement-breakpoint
ALTER TABLE "institutional_campaign_governance" ADD CONSTRAINT "institutional_governance_funding_check" CHECK ("funding_amount_minor" IS NULL OR "funding_amount_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "institutional_campaign_partners" ADD CONSTRAINT "institutional_partner_state_check" CHECK ("state" IN ('pending','approved','rejected'));
--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_analysis_state_check" CHECK ("state" IN ('queued','processing','needs_review','approved','rejected','failed','withdrawn','purged'));
--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_analysis_confidence_check" CHECK ("confidence_bps" IS NULL OR ("confidence_bps" >= 0 AND "confidence_bps" <= 10000));
--> statement-breakpoint
ALTER TABLE "talent_document_analyses" ADD CONSTRAINT "talent_analysis_no_automated_decision_check" CHECK ("raw_text_persisted" = false AND "automated_decision" = false);
--> statement-breakpoint
ALTER TABLE "vendor_onboarding_connectors" ADD CONSTRAINT "vendor_connector_sandbox_check" CHECK ("execution_mode" = 'sandbox' AND "external_account_creation" = false AND "target_count" > 0);
--> statement-breakpoint
ALTER TABLE "vendor_representative_handoffs" ADD CONSTRAINT "vendor_handoff_state_check" CHECK ("state" IN ('selected','handoff_ready','sandbox_provisioned','activated','completed','failed','revoked'));
--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_cycles_check" CHECK ("max_cycles" BETWEEN 1 AND 120 AND "interval_months" BETWEEN 1 AND 12 AND "cycle_number" BETWEEN 1 AND "max_cycles");
--> statement-breakpoint
ALTER TABLE "commission_recurrence_schedules" ADD CONSTRAINT "commission_recurrence_state_check" CHECK ("state" IN ('scheduled','awaiting_evidence','completed','cancelled'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "phase19_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Phase 19 evidence records are append-only'; END; $$;
--> statement-breakpoint
CREATE TRIGGER "vendor_progress_append_only" BEFORE UPDATE OR DELETE ON "vendor_connector_progress_events" FOR EACH ROW EXECUTE FUNCTION "phase19_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "recurrence_receipt_append_only" BEFORE UPDATE OR DELETE ON "commission_recurrence_receipts" FOR EACH ROW EXECUTE FUNCTION "phase19_append_only_guard"();
