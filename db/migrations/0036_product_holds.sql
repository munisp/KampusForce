ALTER TABLE "products" ADD COLUMN "held_reason" varchar(300);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "held_by_user_id" integer;