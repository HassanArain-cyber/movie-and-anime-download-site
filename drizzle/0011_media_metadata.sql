ALTER TABLE "media" ADD COLUMN "genres" text;
ALTER TABLE "media" ADD COLUMN "episode_count" integer;
ALTER TABLE "media" ADD COLUMN "external_source" varchar(20);
ALTER TABLE "media" ADD COLUMN "external_id" varchar(60);
CREATE INDEX IF NOT EXISTS "media_external_source_id_idx" ON "media" ("external_source", "external_id");
