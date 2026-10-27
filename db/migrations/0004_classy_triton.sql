CREATE TYPE "public"."incident_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_state" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "operational_incident_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"actor_user_id" integer,
	"action" varchar(80) NOT NULL,
	"from_state" "incident_state",
	"to_state" "incident_state",
	"note" text,
	"evidence_json" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"source" varchar(60) NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"state" "incident_state" DEFAULT 'open' NOT NULL,
	"title" varchar(180) NOT NULL,
	"detail" text NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by_user_id" integer,
	"acknowledged_at" timestamp with time zone,
	"resolved_by_user_id" integer,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_incidents_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "operational_incident_events" ADD CONSTRAINT "operational_incident_events_incident_id_operational_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."operational_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_incident_events" ADD CONSTRAINT "operational_incident_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_incidents" ADD CONSTRAINT "operational_incidents_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_incidents" ADD CONSTRAINT "operational_incidents_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_incident_event_idx" ON "operational_incident_events" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "operational_incident_state_idx" ON "operational_incidents" USING btree ("state","severity","last_seen_at");--> statement-breakpoint
CREATE INDEX "operational_incident_entity_idx" ON "operational_incidents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE TRIGGER "operational_incident_events_append_only" BEFORE UPDATE OR DELETE ON "operational_incident_events" FOR EACH ROW EXECUTE FUNCTION "kf_prevent_history_mutation"();
