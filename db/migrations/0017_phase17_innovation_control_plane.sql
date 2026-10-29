CREATE TABLE "activation_evidence_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_node_id" integer NOT NULL,
	"to_node_id" integer NOT NULL,
	"relationship" varchar(60) NOT NULL,
	"rationale" varchar(500) NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activation_evidence_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_ref" varchar(48) NOT NULL,
	"deal_id" integer,
	"kind" varchar(60) NOT NULL,
	"source" varchar(100) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"metadata_json" json DEFAULT '{}'::json NOT NULL,
	"recorded_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_evidence_nodes_node_ref_unique" UNIQUE("node_ref")
);
--> statement-breakpoint
CREATE TABLE "benchmark_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_ref" varchar(48) NOT NULL,
	"scope_type" varchar(30) NOT NULL,
	"metric_key" varchar(80) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"minimum_cohort" integer NOT NULL,
	"cells_json" json NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_snapshots_snapshot_ref_unique" UNIQUE("snapshot_ref")
);
--> statement-breakpoint
CREATE TABLE "case_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"message_id" integer,
	"object_key" varchar(600) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(160) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"review_status" varchar(40) NOT NULL,
	"visibility" varchar(30) NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"deleted_by_user_id" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_attachments_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "case_channel_intakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"intake_ref" varchar(48) NOT NULL,
	"channel" varchar(30) NOT NULL,
	"external_id_hash" varchar(64) NOT NULL,
	"ticket_id" integer,
	"state" varchar(30) NOT NULL,
	"mode" varchar(30) DEFAULT 'sandbox_simulation' NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_channel_intakes_intake_ref_unique" UNIQUE("intake_ref")
);
--> statement-breakpoint
CREATE TABLE "case_copilot_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_ref" varchar(48) NOT NULL,
	"ticket_id" integer NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"summary" text NOT NULL,
	"redactions_json" json NOT NULL,
	"suggested_actions_json" json NOT NULL,
	"model_version" varchar(40) NOT NULL,
	"state" varchar(30) DEFAULT 'proposed' NOT NULL,
	"accepted_by_user_id" integer,
	"accepted_at" timestamp with time zone,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_copilot_runs_run_ref_unique" UNIQUE("run_ref")
);
--> statement-breakpoint
CREATE TABLE "case_experience_surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"respondent_token_hash" varchar(64) NOT NULL,
	"csat" integer NOT NULL,
	"effort" integer NOT NULL,
	"comment" varchar(1000),
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_knowledge_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"article_id" integer NOT NULL,
	"helpful" boolean,
	"linked_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_quality_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"reviewer_user_id" integer NOT NULL,
	"rubric_version" varchar(40) NOT NULL,
	"scores_json" json NOT NULL,
	"total_score" integer NOT NULL,
	"coaching_note" text NOT NULL,
	"state" varchar(30) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_routing_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"rule_id" integer,
	"proposed_user_id" integer,
	"workload" integer NOT NULL,
	"reasons_json" json NOT NULL,
	"state" varchar(30) DEFAULT 'proposed' NOT NULL,
	"decided_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" varchar(80),
	"vendor_id" integer,
	"skill" varchar(80) NOT NULL,
	"max_open_cases" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_sla_intervals" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_sla_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"priority" varchar(30) NOT NULL,
	"first_response_minutes" integer NOT NULL,
	"resolution_minutes" integer NOT NULL,
	"timezone" varchar(60) DEFAULT 'Africa/Lagos' NOT NULL,
	"business_start_minute" integer DEFAULT 480 NOT NULL,
	"business_end_minute" integer DEFAULT 1020 NOT NULL,
	"business_days" json DEFAULT '[1,2,3,4,5]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"capability" varchar(80) NOT NULL,
	"recommendation" text NOT NULL,
	"rationale" text NOT NULL,
	"model_version" varchar(40) NOT NULL,
	"state" varchar(30) DEFAULT 'open' NOT NULL,
	"acknowledged_by_user_id" integer,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_key" varchar(80) NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"trigger_event" varchar(100) NOT NULL,
	"conditions_json" json NOT NULL,
	"action" varchar(80) NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"published_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "control_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_ref" varchar(48) NOT NULL,
	"control_id" integer NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"matched" boolean NOT NULL,
	"decision" varchar(80) NOT NULL,
	"explanation" text NOT NULL,
	"mode" varchar(30) DEFAULT 'simulation' NOT NULL,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_runs_run_ref_unique" UNIQUE("run_ref")
);
--> statement-breakpoint
CREATE TABLE "crm_collaboration_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"author_user_id" integer NOT NULL,
	"body" text NOT NULL,
	"visibility" varchar(30) DEFAULT 'team' NOT NULL,
	"mentioned_user_ids" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_duplicate_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"matched_opportunity_id" integer NOT NULL,
	"match_type" varchar(60) NOT NULL,
	"confidence" integer NOT NULL,
	"state" varchar(30) DEFAULT 'open' NOT NULL,
	"reviewed_by_user_id" integer,
	"review_reason" varchar(500),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"category" varchar(60) NOT NULL,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"source" varchar(60) NOT NULL,
	"consent_event_id" bigint,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_forecast_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"forecast_ref" varchar(48) NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"scenario" varchar(30) NOT NULL,
	"assumptions_json" json NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"opportunity_count" integer NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_forecast_scenarios_forecast_ref_unique" UNIQUE("forecast_ref")
);
--> statement-breakpoint
CREATE TABLE "crm_influence_touchpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"campaign_id" integer,
	"promotion_id" integer,
	"touch_type" varchar(60) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"evidence_ref" varchar(120) NOT NULL,
	"financial_attribution_changed" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"action_type" varchar(60) NOT NULL,
	"recommendation" text NOT NULL,
	"reasons_json" json NOT NULL,
	"priority" integer NOT NULL,
	"model_version" varchar(40) NOT NULL,
	"state" varchar(30) DEFAULT 'open' NOT NULL,
	"feedback" varchar(500),
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_routing_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"rule_id" integer,
	"proposed_rep_id" integer,
	"workload" integer NOT NULL,
	"reasons_json" json NOT NULL,
	"state" varchar(30) DEFAULT 'proposed' NOT NULL,
	"decided_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"campus_id" integer,
	"product_id" integer,
	"max_open_opportunities" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_scorecards" (
	"id" serial PRIMARY KEY NOT NULL,
	"scorecard_key" varchar(80) NOT NULL,
	"version" integer NOT NULL,
	"weights_json" json NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"rationale" text NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sequence_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_id" integer NOT NULL,
	"step_number" integer NOT NULL,
	"channel" varchar(30) NOT NULL,
	"body" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" varchar(30) DEFAULT 'pending' NOT NULL,
	"delivery_mode" varchar(30) DEFAULT 'sandbox_simulation' NOT NULL,
	"completed_by_user_id" integer,
	"completed_at" timestamp with time zone,
	"receipt_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"purpose" varchar(100) NOT NULL,
	"subject_token_hash" varchar(64) NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"approved_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"update_type" varchar(40) NOT NULL,
	"body" text NOT NULL,
	"visibility" varchar(30) DEFAULT 'internal' NOT NULL,
	"author_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "independent_outcome_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"observation_ref" varchar(48) NOT NULL,
	"deal_id" integer NOT NULL,
	"observer" varchar(100) NOT NULL,
	"outcome" varchar(60) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reconciliation_state" varchar(40) DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"review_reason" varchar(500),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "independent_outcome_observations_observation_ref_unique" UNIQUE("observation_ref")
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_key" varchar(80) NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"category" varchar(80) NOT NULL,
	"body" text NOT NULL,
	"keywords" json DEFAULT '[]'::json NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"approved_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "major_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_ref" varchar(48) NOT NULL,
	"title" varchar(200) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"state" varchar(30) DEFAULT 'investigating' NOT NULL,
	"commander_user_id" integer NOT NULL,
	"problem_id" integer,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "major_incidents_incident_ref_unique" UNIQUE("incident_ref")
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"metric_key" varchar(80) NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"formula" text NOT NULL,
	"source_contract" text NOT NULL,
	"state" varchar(30) DEFAULT 'draft' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"published_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_ref" varchar(48) NOT NULL,
	"definition_id" integer NOT NULL,
	"scope_type" varchar(40) NOT NULL,
	"scope_id" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"value_numerator" bigint NOT NULL,
	"value_denominator" bigint NOT NULL,
	"input_count" integer NOT NULL,
	"source_hash" varchar(64) NOT NULL,
	"explanation" text NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_snapshot_ref_unique" UNIQUE("snapshot_ref")
);
--> statement-breakpoint
CREATE TABLE "portability_manifests" (
	"id" serial PRIMARY KEY NOT NULL,
	"manifest_ref" varchar(48) NOT NULL,
	"provider_id" integer NOT NULL,
	"schema_version" varchar(40) NOT NULL,
	"artifact_count" integer NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"redactions_json" json NOT NULL,
	"verification_state" varchar(30) NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portability_manifests_manifest_ref_unique" UNIQUE("manifest_ref")
);
--> statement-breakpoint
CREATE TABLE "problem_case_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problem_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_ref" varchar(48) NOT NULL,
	"title" varchar(200) NOT NULL,
	"state" varchar(30) DEFAULT 'investigating' NOT NULL,
	"root_cause" text,
	"workaround" text,
	"owner_user_id" integer,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_records_problem_ref_unique" UNIQUE("problem_ref")
);
--> statement-breakpoint
CREATE TABLE "promotion_simulations" (
	"id" serial PRIMARY KEY NOT NULL,
	"simulation_ref" varchar(48) NOT NULL,
	"promotion_id" integer,
	"name" varchar(160) NOT NULL,
	"assumptions_json" json NOT NULL,
	"results_json" json NOT NULL,
	"model_version" varchar(40) NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_simulations_simulation_ref_unique" UNIQUE("simulation_ref")
);
--> statement-breakpoint
CREATE TABLE "provider_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_key" varchar(80) NOT NULL,
	"capability" varchar(80) NOT NULL,
	"mode" varchar(30) DEFAULT 'sandbox' NOT NULL,
	"portability_tier" varchar(40) NOT NULL,
	"config_hash" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_profiles_provider_key_unique" UNIQUE("provider_key")
);
--> statement-breakpoint
CREATE TABLE "purpose_access_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_token_hash" varchar(64) NOT NULL,
	"purpose" varchar(100) NOT NULL,
	"action" varchar(100) NOT NULL,
	"decision" varchar(30) NOT NULL,
	"reason" varchar(300) NOT NULL,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purpose_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" varchar(100) NOT NULL,
	"version" integer NOT NULL,
	"notice" text NOT NULL,
	"notice_hash" varchar(64) NOT NULL,
	"retention_days" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rep_capability_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"capability" varchar(80) NOT NULL,
	"level" integer NOT NULL,
	"evidence_type" varchar(60) NOT NULL,
	"evidence_ref" varchar(120) NOT NULL,
	"assessor_user_id" integer,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resilience_drills" (
	"id" serial PRIMARY KEY NOT NULL,
	"drill_ref" varchar(48) NOT NULL,
	"provider_id" integer NOT NULL,
	"scenario" varchar(80) NOT NULL,
	"checks_json" json NOT NULL,
	"recovery_seconds" integer NOT NULL,
	"state" varchar(30) NOT NULL,
	"mode" varchar(30) DEFAULT 'simulation' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resilience_drills_drill_ref_unique" UNIQUE("drill_ref")
);
--> statement-breakpoint
CREATE TABLE "risk_timing_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"assessment_ref" varchar(48) NOT NULL,
	"deal_id" integer NOT NULL,
	"score" integer NOT NULL,
	"reasons_json" json NOT NULL,
	"recommended_review_hours" integer NOT NULL,
	"recommended_payout_delay_hours" integer NOT NULL,
	"policy_version" varchar(40) NOT NULL,
	"state" varchar(30) DEFAULT 'recommended' NOT NULL,
	"decided_by_user_id" integer,
	"decision_reason" varchar(500),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_timing_assessments_assessment_ref_unique" UNIQUE("assessment_ref")
);
--> statement-breakpoint
CREATE TABLE "universal_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_token_hash" varchar(64) NOT NULL,
	"purpose" varchar(100) NOT NULL,
	"policy_id" integer NOT NULL,
	"state" varchar(30) NOT NULL,
	"evidence_ref" varchar(160) NOT NULL,
	"captured_by_user_id" integer,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activation_evidence_edges" ADD CONSTRAINT "activation_evidence_edges_from_node_id_activation_evidence_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."activation_evidence_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_evidence_edges" ADD CONSTRAINT "activation_evidence_edges_to_node_id_activation_evidence_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."activation_evidence_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_evidence_edges" ADD CONSTRAINT "activation_evidence_edges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_evidence_nodes" ADD CONSTRAINT "activation_evidence_nodes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_evidence_nodes" ADD CONSTRAINT "activation_evidence_nodes_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_snapshots" ADD CONSTRAINT "benchmark_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_message_id_case_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."case_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_channel_intakes" ADD CONSTRAINT "case_channel_intakes_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_channel_intakes" ADD CONSTRAINT "case_channel_intakes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_copilot_runs" ADD CONSTRAINT "case_copilot_runs_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_copilot_runs" ADD CONSTRAINT "case_copilot_runs_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_copilot_runs" ADD CONSTRAINT "case_copilot_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_experience_surveys" ADD CONSTRAINT "case_experience_surveys_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_experience_surveys" ADD CONSTRAINT "case_experience_surveys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_knowledge_links" ADD CONSTRAINT "case_knowledge_links_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_knowledge_links" ADD CONSTRAINT "case_knowledge_links_article_id_knowledge_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."knowledge_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_knowledge_links" ADD CONSTRAINT "case_knowledge_links_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_quality_reviews" ADD CONSTRAINT "case_quality_reviews_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_quality_reviews" ADD CONSTRAINT "case_quality_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_routing_decisions" ADD CONSTRAINT "case_routing_decisions_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_routing_decisions" ADD CONSTRAINT "case_routing_decisions_rule_id_case_routing_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."case_routing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_routing_decisions" ADD CONSTRAINT "case_routing_decisions_proposed_user_id_users_id_fk" FOREIGN KEY ("proposed_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_routing_decisions" ADD CONSTRAINT "case_routing_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_routing_rules" ADD CONSTRAINT "case_routing_rules_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_routing_rules" ADD CONSTRAINT "case_routing_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sla_intervals" ADD CONSTRAINT "case_sla_intervals_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sla_intervals" ADD CONSTRAINT "case_sla_intervals_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sla_policies" ADD CONSTRAINT "case_sla_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendations" ADD CONSTRAINT "coaching_recommendations_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_recommendations" ADD CONSTRAINT "coaching_recommendations_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_definitions" ADD CONSTRAINT "control_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_definitions" ADD CONSTRAINT "control_definitions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_runs" ADD CONSTRAINT "control_runs_control_id_control_definitions_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."control_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_runs" ADD CONSTRAINT "control_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_collaboration_notes" ADD CONSTRAINT "crm_collaboration_notes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_collaboration_notes" ADD CONSTRAINT "crm_collaboration_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_duplicate_reviews" ADD CONSTRAINT "crm_duplicate_reviews_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_duplicate_reviews" ADD CONSTRAINT "crm_duplicate_reviews_matched_opportunity_id_opportunities_id_fk" FOREIGN KEY ("matched_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_duplicate_reviews" ADD CONSTRAINT "crm_duplicate_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_feedback" ADD CONSTRAINT "crm_feedback_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_feedback" ADD CONSTRAINT "crm_feedback_consent_event_id_purpose_access_events_id_fk" FOREIGN KEY ("consent_event_id") REFERENCES "public"."purpose_access_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_feedback" ADD CONSTRAINT "crm_feedback_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_forecast_scenarios" ADD CONSTRAINT "crm_forecast_scenarios_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_influence_touchpoints" ADD CONSTRAINT "crm_influence_touchpoints_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_influence_touchpoints" ADD CONSTRAINT "crm_influence_touchpoints_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_influence_touchpoints" ADD CONSTRAINT "crm_influence_touchpoints_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_influence_touchpoints" ADD CONSTRAINT "crm_influence_touchpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_recommendations" ADD CONSTRAINT "crm_recommendations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_recommendations" ADD CONSTRAINT "crm_recommendations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_decisions" ADD CONSTRAINT "crm_routing_decisions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_decisions" ADD CONSTRAINT "crm_routing_decisions_rule_id_crm_routing_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."crm_routing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_decisions" ADD CONSTRAINT "crm_routing_decisions_proposed_rep_id_reps_id_fk" FOREIGN KEY ("proposed_rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_decisions" ADD CONSTRAINT "crm_routing_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_rules" ADD CONSTRAINT "crm_routing_rules_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_rules" ADD CONSTRAINT "crm_routing_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_routing_rules" ADD CONSTRAINT "crm_routing_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_scorecards" ADD CONSTRAINT "crm_scorecards_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_steps" ADD CONSTRAINT "crm_sequence_steps_sequence_id_crm_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."crm_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_steps" ADD CONSTRAINT "crm_sequence_steps_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_major_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."major_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independent_outcome_observations" ADD CONSTRAINT "independent_outcome_observations_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "independent_outcome_observations" ADD CONSTRAINT "independent_outcome_observations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_incidents" ADD CONSTRAINT "major_incidents_commander_user_id_users_id_fk" FOREIGN KEY ("commander_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_incidents" ADD CONSTRAINT "major_incidents_problem_id_problem_records_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_incidents" ADD CONSTRAINT "major_incidents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_definition_id_metric_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."metric_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portability_manifests" ADD CONSTRAINT "portability_manifests_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portability_manifests" ADD CONSTRAINT "portability_manifests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_case_links" ADD CONSTRAINT "problem_case_links_problem_id_problem_records_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problem_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_case_links" ADD CONSTRAINT "problem_case_links_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_case_links" ADD CONSTRAINT "problem_case_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_records" ADD CONSTRAINT "problem_records_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_records" ADD CONSTRAINT "problem_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_simulations" ADD CONSTRAINT "promotion_simulations_promotion_id_vendor_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."vendor_promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_simulations" ADD CONSTRAINT "promotion_simulations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purpose_access_events" ADD CONSTRAINT "purpose_access_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purpose_policies" ADD CONSTRAINT "purpose_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_capability_evidence" ADD CONSTRAINT "rep_capability_evidence_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_capability_evidence" ADD CONSTRAINT "rep_capability_evidence_assessor_user_id_users_id_fk" FOREIGN KEY ("assessor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resilience_drills" ADD CONSTRAINT "resilience_drills_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resilience_drills" ADD CONSTRAINT "resilience_drills_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_timing_assessments" ADD CONSTRAINT "risk_timing_assessments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_timing_assessments" ADD CONSTRAINT "risk_timing_assessments_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universal_consents" ADD CONSTRAINT "universal_consents_policy_id_purpose_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."purpose_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universal_consents" ADD CONSTRAINT "universal_consents_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activation_evidence_edge_unique" ON "activation_evidence_edges" USING btree ("from_node_id","to_node_id","relationship");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_evidence_source_hash_unique" ON "activation_evidence_nodes" USING btree ("source","evidence_hash");--> statement-breakpoint
CREATE INDEX "activation_evidence_deal_idx" ON "activation_evidence_nodes" USING btree ("deal_id","observed_at");--> statement-breakpoint
CREATE INDEX "benchmark_scope_period_idx" ON "benchmark_snapshots" USING btree ("scope_type","metric_key","period_end");--> statement-breakpoint
CREATE INDEX "case_attachment_ticket_idx" ON "case_attachments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "case_attachment_uploader_idx" ON "case_attachments" USING btree ("uploaded_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_channel_external_unique" ON "case_channel_intakes" USING btree ("channel","external_id_hash");--> statement-breakpoint
CREATE INDEX "case_channel_ticket_idx" ON "case_channel_intakes" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "case_copilot_ticket_idx" ON "case_copilot_runs" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "case_copilot_state_idx" ON "case_copilot_runs" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_experience_respondent_unique" ON "case_experience_surveys" USING btree ("ticket_id","respondent_token_hash");--> statement-breakpoint
CREATE INDEX "case_experience_created_idx" ON "case_experience_surveys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_knowledge_link_unique" ON "case_knowledge_links" USING btree ("ticket_id","article_id");--> statement-breakpoint
CREATE INDEX "case_knowledge_article_idx" ON "case_knowledge_links" USING btree ("article_id","helpful");--> statement-breakpoint
CREATE INDEX "case_quality_ticket_idx" ON "case_quality_reviews" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "case_quality_reviewer_idx" ON "case_quality_reviews" USING btree ("reviewer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "case_routing_ticket_idx" ON "case_routing_decisions" USING btree ("ticket_id","state","created_at");--> statement-breakpoint
CREATE INDEX "case_routing_match_idx" ON "case_routing_rules" USING btree ("active","category","vendor_id","priority");--> statement-breakpoint
CREATE INDEX "case_sla_interval_ticket_idx" ON "case_sla_intervals" USING btree ("ticket_id","kind","started_at");--> statement-breakpoint
CREATE INDEX "case_sla_interval_open_idx" ON "case_sla_intervals" USING btree ("ended_at","kind");--> statement-breakpoint
CREATE INDEX "case_sla_policy_idx" ON "case_sla_policies" USING btree ("priority","active");--> statement-breakpoint
CREATE INDEX "coaching_rep_state_idx" ON "coaching_recommendations" USING btree ("rep_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "control_definition_version_unique" ON "control_definitions" USING btree ("control_key","version");--> statement-breakpoint
CREATE INDEX "control_definition_trigger_idx" ON "control_definitions" USING btree ("trigger_event","state");--> statement-breakpoint
CREATE INDEX "control_run_control_idx" ON "control_runs" USING btree ("control_id","created_at");--> statement-breakpoint
CREATE INDEX "control_run_decision_idx" ON "control_runs" USING btree ("decision","created_at");--> statement-breakpoint
CREATE INDEX "crm_collaboration_opportunity_idx" ON "crm_collaboration_notes" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_duplicate_pair_unique" ON "crm_duplicate_reviews" USING btree ("opportunity_id","matched_opportunity_id");--> statement-breakpoint
CREATE INDEX "crm_duplicate_state_idx" ON "crm_duplicate_reviews" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "crm_feedback_opportunity_idx" ON "crm_feedback" USING btree ("opportunity_id","category","created_at");--> statement-breakpoint
CREATE INDEX "crm_forecast_owner_idx" ON "crm_forecast_scenarios" USING btree ("owner_user_id","scenario","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_influence_evidence_unique" ON "crm_influence_touchpoints" USING btree ("opportunity_id","touch_type","evidence_ref");--> statement-breakpoint
CREATE INDEX "crm_influence_promotion_idx" ON "crm_influence_touchpoints" USING btree ("promotion_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_recommendation_opportunity_idx" ON "crm_recommendations" USING btree ("opportunity_id","state","created_at");--> statement-breakpoint
CREATE INDEX "crm_routing_opportunity_idx" ON "crm_routing_decisions" USING btree ("opportunity_id","state","created_at");--> statement-breakpoint
CREATE INDEX "crm_routing_match_idx" ON "crm_routing_rules" USING btree ("active","campus_id","product_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_scorecard_version_unique" ON "crm_scorecards" USING btree ("scorecard_key","version");--> statement-breakpoint
CREATE INDEX "crm_scorecard_active_idx" ON "crm_scorecards" USING btree ("scorecard_key","active");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sequence_step_unique" ON "crm_sequence_steps" USING btree ("sequence_id","step_number");--> statement-breakpoint
CREATE INDEX "crm_sequence_step_due_idx" ON "crm_sequence_steps" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "crm_sequence_opportunity_idx" ON "crm_sequences" USING btree ("opportunity_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "incident_update_timeline_idx" ON "incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "independent_outcome_evidence_unique" ON "independent_outcome_observations" USING btree ("deal_id","observer","evidence_hash");--> statement-breakpoint
CREATE INDEX "independent_outcome_review_idx" ON "independent_outcome_observations" USING btree ("reconciliation_state","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_article_version_unique" ON "knowledge_articles" USING btree ("article_key","version");--> statement-breakpoint
CREATE INDEX "knowledge_article_search_idx" ON "knowledge_articles" USING btree ("state","category");--> statement-breakpoint
CREATE INDEX "major_incident_state_idx" ON "major_incidents" USING btree ("state","severity","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definition_version_unique" ON "metric_definitions" USING btree ("metric_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshot_reproducible_unique" ON "metric_snapshots" USING btree ("definition_id","scope_type","scope_id","period_start","period_end","source_hash");--> statement-breakpoint
CREATE INDEX "metric_snapshot_scope_idx" ON "metric_snapshots" USING btree ("scope_type","scope_id","period_end");--> statement-breakpoint
CREATE INDEX "portability_provider_idx" ON "portability_manifests" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "problem_case_unique" ON "problem_case_links" USING btree ("problem_id","ticket_id");--> statement-breakpoint
CREATE INDEX "problem_case_ticket_idx" ON "problem_case_links" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "problem_state_idx" ON "problem_records" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "promotion_simulation_promotion_idx" ON "promotion_simulations" USING btree ("promotion_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_capability_idx" ON "provider_profiles" USING btree ("capability","active","mode");--> statement-breakpoint
CREATE INDEX "purpose_access_subject_idx" ON "purpose_access_events" USING btree ("subject_token_hash","purpose","created_at");--> statement-breakpoint
CREATE INDEX "purpose_access_decision_idx" ON "purpose_access_events" USING btree ("decision","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purpose_policy_version_unique" ON "purpose_policies" USING btree ("purpose","version");--> statement-breakpoint
CREATE INDEX "purpose_policy_active_idx" ON "purpose_policies" USING btree ("purpose","active");--> statement-breakpoint
CREATE UNIQUE INDEX "rep_capability_evidence_unique" ON "rep_capability_evidence" USING btree ("rep_id","capability","evidence_type","evidence_ref");--> statement-breakpoint
CREATE INDEX "rep_capability_idx" ON "rep_capability_evidence" USING btree ("rep_id","capability","observed_at");--> statement-breakpoint
CREATE INDEX "resilience_provider_idx" ON "resilience_drills" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_timing_deal_idx" ON "risk_timing_assessments" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_timing_state_idx" ON "risk_timing_assessments" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "universal_consent_lookup_idx" ON "universal_consents" USING btree ("subject_token_hash","purpose","state","expires_at");--> statement-breakpoint
CREATE INDEX "universal_consent_policy_idx" ON "universal_consents" USING btree ("policy_id","created_at");