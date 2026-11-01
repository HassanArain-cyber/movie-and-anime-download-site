CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_rate_limits_expires_at_idx" ON "auth_rate_limits" USING btree ("expires_at");