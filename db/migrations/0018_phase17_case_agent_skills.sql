CREATE TABLE "case_agent_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"skill" varchar(80) NOT NULL,
	"level" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assessed_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_agent_skills" ADD CONSTRAINT "case_agent_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_agent_skills" ADD CONSTRAINT "case_agent_skills_assessed_by_user_id_users_id_fk" FOREIGN KEY ("assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_agent_skill_unique" ON "case_agent_skills" USING btree ("user_id","skill");--> statement-breakpoint
CREATE INDEX "case_agent_skill_lookup_idx" ON "case_agent_skills" USING btree ("skill","active","level");