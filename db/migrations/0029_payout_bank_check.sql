ALTER TABLE "payout_destinations" ADD COLUMN "name_check" varchar(16) DEFAULT 'unchecked' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD COLUMN "bank_name" varchar(120);--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD COLUMN "reviewed_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD COLUMN "review_note" varchar(500);