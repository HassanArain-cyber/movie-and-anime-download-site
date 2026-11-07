CREATE TABLE "content_state" (
	"kind" varchar(16) NOT NULL,
	"content_id" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"is_anime_movie" boolean DEFAULT false NOT NULL,
	CONSTRAINT "content_state_kind_content_id_pk" PRIMARY KEY("kind","content_id"),
	CONSTRAINT "content_state_kind_check" CHECK ("kind" IN ('media', 'season', 'episode')),
	CONSTRAINT "content_state_anime_movie_check" CHECK (NOT "is_anime_movie" OR "kind" = 'media')
);
--> statement-breakpoint
CREATE INDEX "content_state_deleted_idx" ON "content_state" USING btree ("deleted_at");