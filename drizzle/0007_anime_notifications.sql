CREATE TABLE "anime_follows" (
	"watch_status" text DEFAULT 'plan_to_watch' NOT NULL,
	CONSTRAINT "anime_follows_watch_status_check" CHECK ("watch_status" IN ('plan_to_watch', 'watching', 'continue', 'on_hold', 'watched')),
	"subscriber_id" varchar(64) NOT NULL,
	"media_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anime_follows_subscriber_id_media_id_pk" PRIMARY KEY("subscriber_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "episode_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscriber_id" varchar(64) NOT NULL,
	"episode_id" integer NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_publications" (
	"episode_id" integer PRIMARY KEY NOT NULL,
	"media_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"episode_number" integer NOT NULL,
	"episode_title" varchar(255),
	"season_number" integer NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anime_follows" ADD CONSTRAINT "anime_follows_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_follows" ADD CONSTRAINT "anime_follows_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_notifications" ADD CONSTRAINT "episode_notifications_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_notifications" ADD CONSTRAINT "episode_notifications_episode_id_episode_publications_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode_publications"("episode_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_publications" ADD CONSTRAINT "episode_publications_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_publications" ADD CONSTRAINT "episode_publications_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_follows_media_idx" ON "anime_follows" USING btree ("media_id","subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_notifications_subscriber_episode_unique" ON "episode_notifications" USING btree ("subscriber_id","episode_id");--> statement-breakpoint
CREATE INDEX "episode_notifications_inbox_idx" ON "episode_notifications" USING btree ("subscriber_id","id");--> statement-breakpoint
CREATE INDEX "episode_publications_pending_idx" ON "episode_publications" USING btree ("processed_at","published_at");--> statement-breakpoint
-- Serialize installation/backfill with link writes. Legacy published episodes
-- are deliberately marked processed: enabling this feature must not spam history.
LOCK TABLE download_links IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE FUNCTION vault_record_episode_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.episode_id IS NOT NULL AND (
    NEW.url ~* '^(https?://[^/[:space:]]+|tg:|magnet:)' OR
    NEW.url LIKE '/uploads/%' OR
    (NEW.storage_provider = 'r2' AND NEW.object_key IS NOT NULL AND length(NEW.object_key) > 0)
  ) THEN
    INSERT INTO episode_publications (episode_id, media_id, title, episode_number, episode_title, season_number, url, published_at)
    SELECT e.id, m.id, m.title, e.episode_number, e.title, s.season_number,
      '/' || m.type || '/' || m.slug || '#episode-' || e.id, clock_timestamp()
    FROM episodes e JOIN media m ON m.id = e.media_id JOIN seasons s ON s.id = e.season_id
    WHERE e.id = NEW.episode_id AND m.type IN ('anime', 'series')
    ON CONFLICT (episode_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
INSERT INTO episode_publications (episode_id, media_id, title, episode_number, episode_title, season_number, url, processed_at)
SELECT e.id, m.id, m.title, e.episode_number, e.title, s.season_number,
  '/' || m.type || '/' || m.slug || '#episode-' || e.id, now()
FROM episodes e JOIN media m ON m.id = e.media_id JOIN seasons s ON s.id = e.season_id
WHERE m.type IN ('anime', 'series') AND EXISTS (
  SELECT 1 FROM download_links d WHERE d.episode_id = e.id AND (
    d.url ~* '^(https?://[^/[:space:]]+|tg:|magnet:)' OR d.url LIKE '/uploads/%' OR
    (d.storage_provider = 'r2' AND d.object_key IS NOT NULL AND length(d.object_key) > 0)
  )
) ON CONFLICT (episode_id) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER vault_episode_first_link AFTER INSERT OR UPDATE OF url, episode_id, storage_provider, object_key ON download_links
FOR EACH ROW EXECUTE FUNCTION vault_record_episode_publication();
