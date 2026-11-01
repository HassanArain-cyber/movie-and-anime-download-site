CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "download_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_id" integer,
	"episode_id" integer,
	"label" varchar(50) DEFAULT 'Download',
	"url" text NOT NULL,
	"file_size" varchar(30),
	"is_uploaded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" varchar(255),
	"duration" varchar(20)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"poster_url" text,
	"thumbnail_url" text,
	"year" integer,
	"category_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "media_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"name" varchar(255)
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'download_links_media_id_media_id_fk' AND conrelid = 'download_links'::regclass) THEN
  ALTER TABLE "download_links" ADD CONSTRAINT "download_links_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'download_links_episode_id_episodes_id_fk' AND conrelid = 'download_links'::regclass) THEN
  ALTER TABLE "download_links" ADD CONSTRAINT "download_links_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episodes_media_id_media_id_fk' AND conrelid = 'episodes'::regclass) THEN
  ALTER TABLE "episodes" ADD CONSTRAINT "episodes_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episodes_season_id_seasons_id_fk' AND conrelid = 'episodes'::regclass) THEN
  ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_category_id_categories_id_fk' AND conrelid = 'media'::regclass) THEN
  ALTER TABLE "media" ADD CONSTRAINT "media_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_media_id_media_id_fk' AND conrelid = 'seasons'::regclass) THEN
  ALTER TABLE "seasons" ADD CONSTRAINT "seasons_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
