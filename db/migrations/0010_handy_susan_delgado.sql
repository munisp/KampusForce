CREATE TYPE "public"."campaign_enrollment_state" AS ENUM('enrolled', 'notified', 'suppressed', 'converted');--> statement-breakpoint
CREATE TYPE "public"."campaign_goal" AS ENUM('activation', 'recruitment', 'training', 'reactivation');--> statement-breakpoint
CREATE TYPE "public"."campaign_state" AS ENUM('draft', 'pending_review', 'approved', 'scheduled', 'active', 'paused', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."case_link_type" AS ENUM('related', 'duplicate', 'blocks');--> statement-breakpoint
CREATE TYPE "public"."case_message_visibility" AS ENUM('internal', 'public');--> statement-breakpoint
CREATE TYPE "public"."integration_mode" AS ENUM('sandbox', 'live');--> statement-breakpoint
CREATE TYPE "public"."integration_service" AS ENUM('catalog', 'crm', 'support', 'messaging');--> statement-breakpoint
CREATE TYPE "public"."integration_state" AS ENUM('configured', 'verified', 'degraded', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."opportunity_stage" AS ENUM('targeted', 'contacted', 'qualified', 'activation_pending', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."opportunity_task_state" AS ENUM('open', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."outreach_draft_state" AS ENUM('draft', 'approved', 'shared', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."recommendation_state" AS ENUM('suggested', 'accepted', 'dismissed', 'converted');--> statement-breakpoint
CREATE TYPE "public"."student_referral_state" AS ENUM('suggested', 'invited', 'declined');--> statement-breakpoint
CREATE TYPE "public"."training_progress_state" AS ENUM('assigned', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "campaign_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"state" "campaign_enrollment_state" DEFAULT 'enrolled' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"converted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"enrollment_id" integer,
	"actor_user_id" integer,
	"event_type" varchar(60) NOT NULL,
	"metadata_json" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_key" varchar(60) NOT NULL,
	"name" varchar(180) NOT NULL,
	"goal" "campaign_goal" NOT NULL,
	"state" "campaign_state" DEFAULT 'draft' NOT NULL,
	"vendor_id" integer,
	"product_id" integer,
	"campus_id" integer,
	"audience_rules" json DEFAULT '{}'::json NOT NULL,
	"message_draft" text NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_campaign_key_unique" UNIQUE("campaign_key")
);
--> statement-breakpoint
CREATE TABLE "case_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"related_ticket_id" integer NOT NULL,
	"link_type" "case_link_type" NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_user_id" integer NOT NULL,
	"visibility" "case_message_visibility" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"filters_json" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_watchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"filters_json" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_ref" varchar(40) NOT NULL,
	"alias" varchar(120) NOT NULL,
	"rep_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"customer_phone_hash" varchar(64),
	"stage" "opportunity_stage" DEFAULT 'targeted' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"score_reasons" json DEFAULT '[]'::json NOT NULL,
	"expected_commission_kobo" bigint DEFAULT 0 NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL,
	"next_action_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lost_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_opportunity_ref_unique" UNIQUE("opportunity_ref")
);
--> statement-breakpoint
CREATE TABLE "opportunity_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"actor_user_id" integer,
	"activity_type" varchar(60) NOT NULL,
	"body" text NOT NULL,
	"metadata_json" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"score" integer NOT NULL,
	"reasons" json NOT NULL,
	"state" "recommendation_state" DEFAULT 'suggested' NOT NULL,
	"opportunity_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"assigned_rep_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"state" "opportunity_task_state" DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"body" text NOT NULL,
	"rationale" text NOT NULL,
	"state" "outreach_draft_state" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" integer,
	"approved_by_user_id" integer,
	"approved_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"recruitment_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" varchar(60) NOT NULL,
	"from_status" "recruitment_status",
	"to_status" "recruitment_status",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_rep_id" integer NOT NULL,
	"campus_id" integer NOT NULL,
	"candidate_name" varchar(160) NOT NULL,
	"strengths" varchar(300) NOT NULL,
	"note" varchar(500),
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"state" "student_referral_state" DEFAULT 'suggested' NOT NULL,
	"recruitment_id" integer,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"converted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"module_id" integer NOT NULL,
	"score" integer NOT NULL,
	"passed" boolean NOT NULL,
	"answers_json" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_key" varchar(80) NOT NULL,
	"title" varchar(180) NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"category" varchar(60) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"passing_score" integer DEFAULT 80 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"quiz_json" json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_modules_module_key_unique" UNIQUE("module_key")
);
--> statement-breakpoint
CREATE TABLE "training_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"module_id" integer NOT NULL,
	"state" "training_progress_state" DEFAULT 'assigned' NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_service_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"service" "integration_service" NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"mode" "integration_mode" DEFAULT 'sandbox' NOT NULL,
	"state" "integration_state" DEFAULT 'configured' NOT NULL,
	"config_json" json DEFAULT '{}'::json NOT NULL,
	"external_credential_required" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_service_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"status" varchar(40) NOT NULL,
	"detail" text NOT NULL,
	"metadata_json" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "source" varchar(60) DEFAULT 'campus_lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "next_follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campus_recruitments" ADD COLUMN "campaign_id" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "assignee_user_id" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "last_public_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reopened_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_enrollment_id_campaign_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."campaign_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_links" ADD CONSTRAINT "case_links_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_links" ADD CONSTRAINT "case_links_related_ticket_id_support_tickets_id_fk" FOREIGN KEY ("related_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_links" ADD CONSTRAINT "case_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_saved_views" ADD CONSTRAINT "case_saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_watchers" ADD CONSTRAINT "case_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_segments" ADD CONSTRAINT "crm_segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_recommendations" ADD CONSTRAINT "opportunity_recommendations_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_recommendations" ADD CONSTRAINT "opportunity_recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_recommendations" ADD CONSTRAINT "opportunity_recommendations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_tasks" ADD CONSTRAINT "opportunity_tasks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_tasks" ADD CONSTRAINT "opportunity_tasks_assigned_rep_id_reps_id_fk" FOREIGN KEY ("assigned_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_tasks" ADD CONSTRAINT "opportunity_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_recruitment_id_campus_recruitments_id_fk" FOREIGN KEY ("recruitment_id") REFERENCES "public"."campus_recruitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_events" ADD CONSTRAINT "recruitment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_referrals" ADD CONSTRAINT "student_referrals_lead_rep_id_reps_id_fk" FOREIGN KEY ("lead_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_referrals" ADD CONSTRAINT "student_referrals_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_referrals" ADD CONSTRAINT "student_referrals_recruitment_id_campus_recruitments_id_fk" FOREIGN KEY ("recruitment_id") REFERENCES "public"."campus_recruitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_referrals" ADD CONSTRAINT "student_referrals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_service_connections" ADD CONSTRAINT "vendor_service_connections_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_service_connections" ADD CONSTRAINT "vendor_service_connections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_service_events" ADD CONSTRAINT "vendor_service_events_connection_id_vendor_service_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."vendor_service_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_enrollment_unique" ON "campaign_enrollments" USING btree ("campaign_id","rep_id");--> statement-breakpoint
CREATE INDEX "campaign_enrollment_rep_idx" ON "campaign_enrollments" USING btree ("rep_id","state");--> statement-breakpoint
CREATE INDEX "campaign_event_idx" ON "campaign_events" USING btree ("campaign_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "campaign_state_schedule_idx" ON "campaigns" USING btree ("state","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "campaign_audience_idx" ON "campaigns" USING btree ("campus_id","product_id","goal");--> statement-breakpoint
CREATE UNIQUE INDEX "case_link_pair_type_unique" ON "case_links" USING btree ("ticket_id","related_ticket_id","link_type");--> statement-breakpoint
CREATE INDEX "case_link_related_idx" ON "case_links" USING btree ("related_ticket_id");--> statement-breakpoint
CREATE INDEX "case_message_ticket_idx" ON "case_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "case_message_visibility_idx" ON "case_messages" USING btree ("visibility","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_saved_view_user_name_unique" ON "case_saved_views" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "case_watcher_unique" ON "case_watchers" USING btree ("ticket_id","user_id");--> statement-breakpoint
CREATE INDEX "case_watcher_user_idx" ON "case_watchers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_segment_user_name_unique" ON "crm_segments" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "opportunity_rep_stage_idx" ON "opportunities" USING btree ("rep_id","stage","next_action_at");--> statement-breakpoint
CREATE INDEX "opportunity_campus_product_idx" ON "opportunities" USING btree ("campus_id","product_id","stage");--> statement-breakpoint
CREATE INDEX "opportunity_customer_idx" ON "opportunities" USING btree ("customer_phone_hash","vendor_id");--> statement-breakpoint
CREATE INDEX "opportunity_activity_timeline_idx" ON "opportunity_activities" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_recommendation_rep_product_unique" ON "opportunity_recommendations" USING btree ("rep_id","product_id");--> statement-breakpoint
CREATE INDEX "opportunity_recommendation_score_idx" ON "opportunity_recommendations" USING btree ("rep_id","state","score");--> statement-breakpoint
CREATE INDEX "opportunity_task_due_idx" ON "opportunity_tasks" USING btree ("assigned_rep_id","state","due_at");--> statement-breakpoint
CREATE INDEX "outreach_draft_opportunity_idx" ON "outreach_drafts" USING btree ("opportunity_id","state","created_at");--> statement-breakpoint
CREATE INDEX "recruitment_event_idx" ON "recruitment_events" USING btree ("recruitment_id","created_at");--> statement-breakpoint
CREATE INDEX "student_referral_lead_state_idx" ON "student_referrals" USING btree ("lead_rep_id","state","created_at");--> statement-breakpoint
CREATE INDEX "training_attempt_user_module_idx" ON "training_attempts" USING btree ("user_id","module_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "training_progress_user_module_unique" ON "training_progress" USING btree ("user_id","module_id");--> statement-breakpoint
CREATE INDEX "training_progress_state_idx" ON "training_progress" USING btree ("user_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_service_connection_unique" ON "vendor_service_connections" USING btree ("vendor_id","service");--> statement-breakpoint
CREATE INDEX "vendor_service_state_idx" ON "vendor_service_connections" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "vendor_service_event_idx" ON "vendor_service_events" USING btree ("connection_id","created_at");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campus_recruitment_follow_up_idx" ON "campus_recruitments" USING btree ("lead_rep_id","next_follow_up_at");