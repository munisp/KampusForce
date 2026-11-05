ALTER TYPE "public"."identity_evidence_kind" ADD VALUE 'manual_document_check';--> statement-breakpoint
ALTER TYPE "public"."identity_evidence_kind" ADD VALUE 'manual_face_check';--> statement-breakpoint
ALTER TYPE "public"."identity_evidence_kind" ADD VALUE 'manual_business_check';--> statement-breakpoint
CREATE TABLE "commission_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"rep_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"state" varchar(20) DEFAULT 'accrued' NOT NULL,
	"payout_id" integer,
	"entry_group" varchar(64) NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "commission_corrections_dispute_id_unique" UNIQUE("dispute_id")
);
--> statement-breakpoint
CREATE TABLE "identity_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"case_id" integer,
	"attestation_id" integer,
	"kind" varchar(40) NOT NULL,
	"content_type" varchar(60) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"object_key" varchar(200) NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "identity_documents_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "identity_cases" ADD COLUMN "review_method" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_corrections" ADD CONSTRAINT "commission_corrections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_documents" ADD CONSTRAINT "identity_documents_case_id_identity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."identity_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_correction_rep_idx" ON "commission_corrections" USING btree ("rep_id","state");--> statement-breakpoint
CREATE INDEX "commission_correction_deal_idx" ON "commission_corrections" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "commission_correction_payout_idx" ON "commission_corrections" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "identity_document_case_idx" ON "identity_documents" USING btree ("case_id","kind");--> statement-breakpoint
CREATE INDEX "identity_document_attestation_idx" ON "identity_documents" USING btree ("attestation_id");--> statement-breakpoint
CREATE INDEX "identity_document_purge_idx" ON "identity_documents" USING btree ("purged_at","uploaded_at");--> statement-breakpoint
UPDATE "identity_cases" SET "review_method" = 'synthetic';
