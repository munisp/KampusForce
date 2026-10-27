CREATE TYPE "public"."launch_gate_state" AS ENUM('not_started', 'evidence_submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."launch_track" AS ENUM('legal', 'finance', 'ops', 'engineering', 'product');--> statement-breakpoint
CREATE TYPE "public"."provider_webhook_state" AS ENUM('processed', 'ignored', 'quarantined');--> statement-breakpoint
CREATE TABLE "launch_gate_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"gate_id" integer NOT NULL,
	"actor_user_id" integer NOT NULL,
	"action" varchar(40) NOT NULL,
	"from_state" "launch_gate_state",
	"to_state" "launch_gate_state" NOT NULL,
	"note" text NOT NULL,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"gate_key" varchar(100) NOT NULL,
	"track" "launch_track" NOT NULL,
	"title" varchar(200) NOT NULL,
	"requirement" text NOT NULL,
	"evidence_hint" text NOT NULL,
	"state" "launch_gate_state" DEFAULT 'not_started' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"evidence_reference" varchar(500),
	"evidence_note" text,
	"submitted_by_user_id" integer,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" integer,
	"approved_at" timestamp with time zone,
	"approval_reference" varchar(500),
	"rejection_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launch_gates_gate_key_unique" UNIQUE("gate_key")
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"provider" varchar(40) NOT NULL,
	"event_key" varchar(64) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"payout_id" integer,
	"payload_json" json NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"state" "provider_webhook_state" DEFAULT 'processed' NOT NULL,
	"quarantine_reason" varchar(300),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "provider_webhook_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "launch_gate_events" ADD CONSTRAINT "launch_gate_events_gate_id_launch_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."launch_gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_gate_events" ADD CONSTRAINT "launch_gate_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_gates" ADD CONSTRAINT "launch_gates_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_gates" ADD CONSTRAINT "launch_gates_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "launch_gate_event_idx" ON "launch_gate_events" USING btree ("gate_id","created_at");--> statement-breakpoint
CREATE INDEX "launch_gate_track_state_idx" ON "launch_gates" USING btree ("track","state","sort_order");--> statement-breakpoint
CREATE INDEX "provider_webhook_payout_idx" ON "provider_webhook_events" USING btree ("payout_id","received_at");--> statement-breakpoint
CREATE INDEX "provider_webhook_state_idx" ON "provider_webhook_events" USING btree ("state","received_at");