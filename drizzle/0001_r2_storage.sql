-- Additive R2 migration. Safe to run once on the existing Vault database.
-- It never drops tables, deletes rows, rewrites URLs, or removes old features.
CREATE TABLE IF NOT EXISTS "r2_uploads" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"bucket" varchar(255) NOT NULL,
	"multipart_upload_id" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"media_id" integer,
	"season_id" integer,
	"episode_id" integer,
	"quality" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "download_links" ADD COLUMN IF NOT EXISTS "season_id" integer;
--> statement-breakpoint
ALTER TABLE "download_links" ADD COLUMN IF NOT EXISTS "quality" varchar(10);
--> statement-breakpoint
ALTER TABLE "download_links" ADD COLUMN IF NOT EXISTS "storage_provider" varchar(16);
--> statement-breakpoint
ALTER TABLE "download_links" ADD COLUMN IF NOT EXISTS "object_key" text;
--> statement-breakpoint
ALTER TABLE "download_links" ADD COLUMN IF NOT EXISTS "size_bytes" bigint;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'r2_uploads_object_key_unique' AND conrelid = 'r2_uploads'::regclass) THEN
  ALTER TABLE "r2_uploads" ADD CONSTRAINT "r2_uploads_object_key_unique" UNIQUE("object_key");
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'download_links_season_id_seasons_id_fk' AND conrelid = 'download_links'::regclass) THEN
  ALTER TABLE "download_links" ADD CONSTRAINT "download_links_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'download_links_object_key_unique' AND conrelid = 'download_links'::regclass) THEN
  ALTER TABLE "download_links" ADD CONSTRAINT "download_links_object_key_unique" UNIQUE("object_key");
 END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "r2_uploads_status_expires_idx" ON "r2_uploads" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "download_links_media_id_idx" ON "download_links" USING btree ("media_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "download_links_season_id_idx" ON "download_links" USING btree ("season_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "download_links_episode_id_idx" ON "download_links" USING btree ("episode_id");
