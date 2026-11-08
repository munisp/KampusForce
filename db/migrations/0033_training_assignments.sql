CREATE TABLE "training_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_id" integer NOT NULL,
	"product_id" integer,
	"campaign_id" integer,
	"required" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_assignment_one_target" CHECK (("training_assignments"."product_id" is null) <> ("training_assignments"."campaign_id" is null))
);
--> statement-breakpoint
ALTER TABLE "training_modules" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_assignment_product_unique" ON "training_assignments" USING btree ("module_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_assignment_campaign_unique" ON "training_assignments" USING btree ("module_id","campaign_id");--> statement-breakpoint
CREATE INDEX "training_assignment_product_idx" ON "training_assignments" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "training_assignment_campaign_idx" ON "training_assignments" USING btree ("campaign_id");