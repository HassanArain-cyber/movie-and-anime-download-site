-- Additive: subscriptions and durable deliveries. No historic alerts are enqueued.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "subscriber_id" varchar(64) NOT NULL,
  "endpoint_hash" varchar(64) NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_hash_unique" ON "push_subscriptions" USING btree ("endpoint_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_subscriber_idx" ON "push_subscriptions" USING btree ("subscriber_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='push_subscriptions_subscriber_id_subscribers_id_fk') THEN
    ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_subscriber_id_subscribers_id_fk"
    FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_id" integer NOT NULL,
  "subscription_id" integer NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "retry_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone,
  "lease_token" varchar(36),
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_deliveries_notification_subscription_unique" ON "push_deliveries" USING btree ("notification_id","subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_deliveries_pending_idx" ON "push_deliveries" USING btree ("sent_at","retry_at","id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='push_deliveries_notification_id_episode_notifications_id_fk') THEN
    ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_episode_notifications_id_fk"
    FOREIGN KEY ("notification_id") REFERENCES "public"."episode_notifications"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='push_deliveries_subscription_id_push_subscriptions_id_fk') THEN
    ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_push_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
