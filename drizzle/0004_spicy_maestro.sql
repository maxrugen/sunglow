ALTER TABLE "push_subscriptions" ADD COLUMN "rating_token" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "rating_followup_at" timestamp with time zone;