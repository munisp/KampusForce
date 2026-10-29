CREATE TYPE "public"."promotion_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."promotion_consent_state" AS ENUM('consented', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."promotion_delivery_state" AS ENUM('simulated', 'blocked', 'queued', 'completed');--> statement-breakpoint
CREATE TYPE "public"."promotion_link_state" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."promotion_orchestration_state" AS ENUM('pending', 'processing', 'processed', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."promotion_state" AS ENUM('draft', 'pending_review', 'approved', 'scheduled', 'active', 'paused', 'budget_exhausted', 'completed', 'rejected');--> statement-breakpoint
CREATE TABLE "promotion_contact_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"promotion_id" integer NOT NULL,
	"customer_ref_hash" varchar(64) NOT NULL,
	"channel" "promotion_channel" NOT NULL,
	"state" "promotion_consent_state" NOT NULL,
	"evidence_ref" varchar(160) NOT NULL,
	"policy_version" varchar(60) NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_delivery_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"promotion_id" integer NOT NULL,
	"connection_id" integer,
	"channel" "promotion_channel" NOT NULL,
	"mode" "integration_mode" NOT NULL,
	"state" "promotion_delivery_state" NOT NULL,
	"consented_count" integer NOT NULL,
	"suppressed_count" integer NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"failure_reason" text,
	"external_request_made" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "promotion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"promotion_id" integer NOT NULL,
	"actor_user_id" integer,
	"event_type" varchar(80) NOT NULL,
	"metadata_json" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"promotion_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"state" "promotion_link_state" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "promotion_orchestration_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" varchar(180) NOT NULL,
	"promotion_id" integer NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"actor_user_id" integer,
	"payload_json" json DEFAULT '{}'::json NOT NULL,
	"state" "promotion_orchestration_state" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(1000),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_orchestration_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "promotion_trigger_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"promotion_id" integer NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"action" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_json" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"promotion_key" varchar(60) NOT NULL,
	"vendor_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"campus_id" integer,
	"name" varchar(180) NOT NULL,
	"brief" text NOT NULL,
	"state" "promotion_state" DEFAULT 'draft' NOT NULL,
	"budget_cap_kobo" bigint NOT NULL,
	"recruitment_target" integer NOT NULL,
	"staffing_warning_pct" integer DEFAULT 80 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recruitment_campaign_id" integer,
	"created_by_user_id" integer NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"target_met_at" timestamp with time zone,
	"budget_stopped_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_promotions_promotion_key_unique" UNIQUE("promotion_key")
);
--> statement-breakpoint
ALTER TABLE "attribution_records" ADD COLUMN "promotion_id" integer;--> statement-breakpoint
ALTER TABLE "vendor_ingestion_retries" ADD COLUMN "promotion_link_id" integer;--> statement-breakpoint
ALTER TABLE "promotion_contact_consents" ADD CONSTRAINT "promotion_contact_consents_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_contact_consents" ADD CONSTRAINT "promotion_contact_consents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_delivery_requests" ADD CONSTRAINT "promotion_delivery_requests_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_delivery_requests" ADD CONSTRAINT "promotion_delivery_requests_connection_id_vendor_service_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."vendor_service_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_delivery_requests" ADD CONSTRAINT "promotion_delivery_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_events" ADD CONSTRAINT "promotion_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_links" ADD CONSTRAINT "promotion_links_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_links" ADD CONSTRAINT "promotion_links_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_orchestration_events" ADD CONSTRAINT "promotion_orchestration_events_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_orchestration_events" ADD CONSTRAINT "promotion_orchestration_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_trigger_rules" ADD CONSTRAINT "promotion_trigger_rules_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_promotions" ADD CONSTRAINT "vendor_promotions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_promotions" ADD CONSTRAINT "vendor_promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_promotions" ADD CONSTRAINT "vendor_promotions_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_promotions" ADD CONSTRAINT "vendor_promotions_recruitment_campaign_id_campaigns_id_fk" FOREIGN KEY ("recruitment_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_promotions" ADD CONSTRAINT "vendor_promotions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_promotions" ADD CONSTRAINT "vendor_promotions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_consent_subject_channel_unique" ON "promotion_contact_consents" USING btree ("promotion_id","channel","customer_ref_hash");--> statement-breakpoint
CREATE INDEX "promotion_consent_state_idx" ON "promotion_contact_consents" USING btree ("promotion_id","channel","state");--> statement-breakpoint
CREATE INDEX "promotion_delivery_idx" ON "promotion_delivery_requests" USING btree ("promotion_id","created_at");--> statement-breakpoint
CREATE INDEX "promotion_delivery_state_idx" ON "promotion_delivery_requests" USING btree ("state","mode");--> statement-breakpoint
CREATE INDEX "promotion_event_idx" ON "promotion_events" USING btree ("promotion_id","created_at");--> statement-breakpoint
CREATE INDEX "promotion_link_rep_idx" ON "promotion_links" USING btree ("rep_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "promotion_link_promotion_idx" ON "promotion_links" USING btree ("promotion_id","state");--> statement-breakpoint
CREATE INDEX "promotion_orchestration_due_idx" ON "promotion_orchestration_events" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "promotion_orchestration_promotion_idx" ON "promotion_orchestration_events" USING btree ("promotion_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_trigger_event_unique" ON "promotion_trigger_rules" USING btree ("promotion_id","event_type");--> statement-breakpoint
CREATE INDEX "promotion_trigger_enabled_idx" ON "promotion_trigger_rules" USING btree ("promotion_id","enabled");--> statement-breakpoint
CREATE INDEX "promotion_vendor_state_idx" ON "vendor_promotions" USING btree ("vendor_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "promotion_schedule_idx" ON "vendor_promotions" USING btree ("state","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "promotion_recruitment_campaign_idx" ON "vendor_promotions" USING btree ("recruitment_campaign_id");--> statement-breakpoint
ALTER TABLE "attribution_records" ADD CONSTRAINT "attribution_records_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_ingestion_retries" ADD CONSTRAINT "vendor_ingestion_retries_promotion_link_id_promotion_links_id_fk" FOREIGN KEY ("promotion_link_id") REFERENCES "public"."promotion_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_promotion_idx" ON "attribution_records" USING btree ("promotion_id","first_touch_at");