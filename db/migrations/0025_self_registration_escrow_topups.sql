CREATE TABLE "escrow_topups" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"reference" varchar(64) NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"failure_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "escrow_topups_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "contact_email" varchar(320);--> statement-breakpoint
ALTER TABLE "escrow_topups" ADD CONSTRAINT "escrow_topups_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escrow_topups_state_idx" ON "escrow_topups" USING btree ("state","created_at");