CREATE TABLE "sunset_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"sunset_at" timestamp with time zone NOT NULL,
	"rating" smallint NOT NULL,
	"predicted_score" smallint NOT NULL,
	"confidence" smallint NOT NULL,
	"scoring_version" integer NOT NULL,
	"weather" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sunset_rating_device_uq" ON "sunset_ratings" USING btree ("device_id","sunset_at","latitude","longitude");