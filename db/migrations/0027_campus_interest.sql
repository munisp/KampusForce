CREATE TABLE "campus_interest" (
	"id" serial PRIMARY KEY NOT NULL,
	"university" varchar(160) NOT NULL,
	"state" varchar(80) NOT NULL,
	"email" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_interest_email_university_unique" ON "campus_interest" USING btree ("email","university");