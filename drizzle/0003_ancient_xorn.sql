ALTER TABLE "push_subscriptions" ADD COLUMN "alert_sunset" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "alert_sunrise" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_sunrise_evening_date" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_sunrise_morning_date" text;