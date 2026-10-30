ALTER TABLE "disputes" ADD COLUMN "previous_deal_state" "deal_state";--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "decided_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_deal_state_idx" ON "disputes" USING btree ("deal_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "reps_user_unique" ON "reps" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_name_unique" UNIQUE("name");