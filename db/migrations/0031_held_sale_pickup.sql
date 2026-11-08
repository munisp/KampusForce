ALTER TABLE "vendor_events" ADD COLUMN "customer_phone_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "vendor_events" ADD COLUMN "picked_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendor_events" ADD COLUMN "picked_up_event_id" varchar(36);--> statement-breakpoint
CREATE INDEX "vendor_event_held_customer_idx" ON "vendor_events" USING btree ("vendor_id","customer_phone_hash","status");