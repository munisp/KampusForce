CREATE TYPE "public"."ingestion_retry_state" AS ENUM('retry_scheduled', 'resolved', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."webhook_credential_state" AS ENUM('active', 'retiring', 'revoked');--> statement-breakpoint
CREATE TABLE "vendor_ingestion_retries" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"vendor_id" integer NOT NULL,
	"type" "vendor_event_type" NOT NULL,
	"payload_json" json NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"customer_ref_hash" varchar(64) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"state" "ingestion_retry_state" DEFAULT 'retry_scheduled' NOT NULL,
	"next_retry_at" timestamp with time zone NOT NULL,
	"last_error_code" varchar(80),
	"vendor_event_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "vendor_ingestion_retries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "vendor_webhook_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"key_version" integer NOT NULL,
	"secret" varchar(128) NOT NULL,
	"state" "webhook_credential_state" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendor_events" ADD COLUMN "webhook_credential_id" integer;--> statement-breakpoint
ALTER TABLE "vendor_events" ADD COLUMN "payload_retain_until" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vendor_events" ADD COLUMN "payload_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendor_ingestion_retries" ADD CONSTRAINT "vendor_ingestion_retries_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_ingestion_retries" ADD CONSTRAINT "vendor_ingestion_retries_vendor_event_id_vendor_events_id_fk" FOREIGN KEY ("vendor_event_id") REFERENCES "public"."vendor_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_webhook_credentials" ADD CONSTRAINT "vendor_webhook_credentials_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_ingestion_retry_due_idx" ON "vendor_ingestion_retries" USING btree ("state","next_retry_at");--> statement-breakpoint
CREATE INDEX "vendor_ingestion_retry_vendor_idx" ON "vendor_ingestion_retries" USING btree ("vendor_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_webhook_credential_version_unique" ON "vendor_webhook_credentials" USING btree ("vendor_id","key_version");--> statement-breakpoint
CREATE INDEX "vendor_webhook_credential_state_idx" ON "vendor_webhook_credentials" USING btree ("vendor_id","state","expires_at");--> statement-breakpoint
ALTER TABLE "vendor_events" ADD CONSTRAINT "vendor_events_webhook_credential_id_vendor_webhook_credentials_id_fk" FOREIGN KEY ("webhook_credential_id") REFERENCES "public"."vendor_webhook_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_event_retention_idx" ON "vendor_events" USING btree ("payload_retain_until","payload_purged_at");--> statement-breakpoint
INSERT INTO "vendor_webhook_credentials" ("vendor_id", "key_version", "secret", "state", "expires_at", "created_at", "revoked_at")
SELECT "id", 1, "webhook_secret", 'active', NULL, "created_at", NULL FROM "vendors";--> statement-breakpoint
UPDATE "vendor_events" SET "payload_retain_until" = "received_at" + interval '30 days';