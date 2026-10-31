CREATE TABLE "notification_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer NOT NULL,
	"channel" varchar(30) DEFAULT 'signed_webhook' NOT NULL,
	"state" varchar(30) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(120),
	"receipt_hash" varchar(64),
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_destinations" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"account_number_ciphertext" text NOT NULL,
	"account_number_iv" varchar(32) NOT NULL,
	"account_number_tag" varchar(32) NOT NULL,
	"account_number_hash" varchar(64) NOT NULL,
	"bank_code" varchar(12) NOT NULL,
	"account_name" varchar(160) NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"key_version" varchar(40) DEFAULT 'v1' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_attempts" ADD COLUMN "execution_mode" varchar(20) DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "execution_mode" varchar(20) DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_unique" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_delivery_dispatch_idx" ON "notification_deliveries" USING btree ("state","available_at");