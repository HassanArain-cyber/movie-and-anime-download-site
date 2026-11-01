ALTER TABLE "r2_uploads" ADD COLUMN IF NOT EXISTS "operation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "r2_uploads" ADD COLUMN IF NOT EXISTS "operation_id" varchar(36);