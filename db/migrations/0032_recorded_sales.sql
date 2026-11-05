CREATE TABLE "recorded_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"rep_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"customer_phone_hash" varchar(64) NOT NULL,
	"customer_phone_last4" varchar(4) NOT NULL,
	"proof_document_id" integer NOT NULL,
	"note" varchar(500),
	"state" varchar(16) DEFAULT 'waiting' NOT NULL,
	"verified_by" varchar(16),
	"reviewer_user_id" integer,
	"review_reason" varchar(500),
	"deal_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "recorded_sales" ADD CONSTRAINT "recorded_sales_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorded_sales" ADD CONSTRAINT "recorded_sales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorded_sales" ADD CONSTRAINT "recorded_sales_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorded_sales" ADD CONSTRAINT "recorded_sales_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recorded_sale_rep_idx" ON "recorded_sales" USING btree ("rep_id","created_at");--> statement-breakpoint
CREATE INDEX "recorded_sale_customer_idx" ON "recorded_sales" USING btree ("vendor_id","customer_phone_hash","state");