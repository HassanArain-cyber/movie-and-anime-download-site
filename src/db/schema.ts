import {
  pgTable,
  check,
  serial,
  text,
  integer,
  timestamp,
  varchar,
  boolean,
  bigint,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Existing tables and columns are retained. R2 additions are nullable so old
// records keep their original IDs, URLs, labels, and relationships.
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
});

export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // movie | anime | series
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  description: text("description"),
  posterUrl: text("poster_url"),
  thumbnailUrl: text("thumbnail_url"),
  year: integer("year"),
  categoryId: integer("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  name: varchar("name", { length: 255 }),
});

export const episodes = pgTable("episodes", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  seasonId: integer("season_id")
    .notNull()
    .references(() => seasons.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull(),
  title: varchar("title", { length: 255 }),
  duration: varchar("duration", { length: 20 }),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
});

export const downloadLinks = pgTable("download_links", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id").references(() => media.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 50 }).default("Download"),
  url: text("url").notNull(),
  fileSize: varchar("file_size", { length: 30 }),
  isUploaded: boolean("is_uploaded").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  // Additive storage/quality metadata. Legacy null values are inferred at read time.
  seasonId: integer("season_id").references(() => seasons.id, { onDelete: "cascade" }),
  quality: varchar("quality", { length: 10 }),
  storageProvider: varchar("storage_provider", { length: 16 }),
  objectKey: text("object_key").unique(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  // Public button behaviour. Legacy rows predate the column and read as "open".
  linkBehavior: varchar("link_behavior", { length: 8 }).notNull().default("open"),
  // Website opened after copying; null inherits the saved site-wide default.
  afterCopyUrl: text("after_copy_url"),
}, (table) => [
  index("download_links_media_id_idx").on(table.mediaId),
  index("download_links_season_id_idx").on(table.seasonId),
  index("download_links_episode_id_idx").on(table.episodeId),
]);

// Audit/lifecycle record for a private R2 multipart upload. Multipart IDs and
// credentials never leave the server. Completed objects are never auto-deleted.
// Target IDs intentionally have no FK: deleting a title must not erase upload history.
export const r2Uploads = pgTable("r2_uploads", {
  id: varchar("id", { length: 36 }).primaryKey(),
  objectKey: text("object_key").notNull().unique(),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  multipartUploadId: text("multipart_upload_id").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  fileName: text("file_name").notNull(),
  contentType: varchar("content_type", { length: 255 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number"}).notNull(),
  partSize: integer("part_size").notNull(),
  mediaId: integer("media_id"),
  seasonId: integer("season_id"),
  episodeId: integer("episode_id"),
  quality: varchar("quality", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Lease for completing/aborting so a crashed worker cannot lock a row forever.
  operationExpiresAt: timestamp("operation_expires_at", { withTimezone: true }),
  operationId: varchar("operation_id", { length: 36 }),
}, (table) => [
  index("r2_uploads_status_expires_idx").on(table.status, table.expiresAt),
]);

// Shared, atomic login-attempt counters. Keys are HMACs, never raw IP addresses.
// The table contains no passwords, cookies, or R2 credentials.
export const authRateLimits = pgTable("auth_rate_limits", {
  key: varchar("key", { length: 64 }).primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("auth_rate_limits_expires_at_idx").on(table.expiresAt),
]);

// Site-wide customization is additive and stores only a validated image URL.
// R2 image URLs resolve through the existing private-image signing endpoint.
export const siteSettings = pgTable("site_settings", {
  key: varchar("setting_key", { length: 100 }).primaryKey(),
  value: text("setting_value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Publicly submitted requests are retained for admin review in PostgreSQL.
export const contactRequests = pgTable("contact_requests", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  requestType: varchar("request_type", { length: 16 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("contact_requests_created_at_idx").on(table.createdAt),
]);

// Anonymous community discussion. author/session identifiers are one-way keyed hashes;
// they are never returned by public APIs and contain no user-provided identity data.
export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
  parentId: integer("parent_id"),
  authorHash: varchar("author_hash", { length: 64 }).notNull(),
  body: text("body").notNull(),
  isSpoiler: boolean("is_spoiler").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("comments_media_created_idx").on(table.mediaId, table.createdAt),
  index("comments_episode_created_idx").on(table.episodeId, table.createdAt),
  index("comments_parent_id_idx").on(table.parentId),
  foreignKey({ columns: [table.parentId], foreignColumns: [table.id], name: "comments_parent_id_comments_id_fk" }).onDelete("cascade"),
]);

export const commentLikes = pgTable("comment_likes", {
  commentId: integer("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  sessionHash: varchar("session_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.commentId, table.sessionHash], name: "comment_likes_pk" }),
]);

export const commentReports = pgTable("comment_reports", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  reporterHash: varchar("reporter_hash", { length: 64 }).notNull(),
  reason: varchar("reason", { length: 32 }).notNull(),
  details: varchar("details", { length: 500 }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("comment_reports_comment_reporter_unique").on(table.commentId, table.reporterHash),
  index("comment_reports_status_created_idx").on(table.status, table.createdAt),
]);

export const mediaRelations = relations(media, ({ one, many }) => ({
  category: one(categories, { fields: [media.categoryId], references: [categories.id] }),
  seasons: many(seasons),
  downloadLinks: many(downloadLinks),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  media: one(media, { fields: [seasons.mediaId], references: [media.id] }),
  episodes: many(episodes),
  downloadLinks: many(downloadLinks),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  media: one(media, { fields: [episodes.mediaId], references: [media.id] }),
  season: one(seasons, { fields: [episodes.seasonId], references: [seasons.id] }),
  downloadLinks: many(downloadLinks),
}));

export const downloadLinksRelations = relations(downloadLinks, ({ one }) => ({
  media: one(media, { fields: [downloadLinks.mediaId], references: [media.id] }),
  season: one(seasons, { fields: [downloadLinks.seasonId], references: [seasons.id] }),
  episode: one(episodes, { fields: [downloadLinks.episodeId], references: [episodes.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  media: many(media),
}));

// Independent anonymous follow identity: only a SHA-256 digest of a random
// 256-bit HttpOnly cookie is stored. Comments/admin sessions are untouched.
export const subscribers = pgTable("subscribers", {
  id: varchar("id", { length: 64 }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const animeFollows = pgTable("anime_follows", {
  watchStatus: text("watch_status").notNull().default("plan_to_watch"),
  subscriberId: varchar("subscriber_id", { length: 64 }).notNull().references(() => subscribers.id, { onDelete: "cascade" }),
  mediaId: integer("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.subscriberId, t.mediaId] }), index("anime_follows_media_idx").on(t.mediaId, t.subscriberId), check("anime_follows_watch_status_check", sql`${sql.identifier("watch_status")} IN ('plan_to_watch', 'watching', 'continue', 'on_hold', 'watched')`)]);
export const episodePublications = pgTable("episode_publications", {
  episodeId: integer("episode_id").primaryKey().references(() => episodes.id, { onDelete: "cascade" }),
  mediaId: integer("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  episodeNumber: integer("episode_number").notNull(),
  episodeTitle: varchar("episode_title", { length: 255 }),
  seasonNumber: integer("season_number").notNull(),
  url: text("url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [index("episode_publications_pending_idx").on(t.processedAt, t.publishedAt)]);
export const episodeNotifications = pgTable("episode_notifications", {
  id: serial("id").primaryKey(),
  subscriberId: varchar("subscriber_id", { length: 64 }).notNull().references(() => subscribers.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").notNull().references(() => episodePublications.episodeId, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("episode_notifications_subscriber_episode_unique").on(t.subscriberId, t.episodeId), index("episode_notifications_inbox_idx").on(t.subscriberId, t.id)]);

// Additive lifecycle markers. Original rows and FK relationships stay intact
// until an admin explicitly confirms permanent deletion. No storage-object FK.
export const contentState = pgTable("content_state", {
  kind: varchar("kind", { length: 16 }).notNull(),
  contentId: integer("content_id").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  isAnimeMovie: boolean("is_anime_movie").notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.kind, t.contentId] }),
  index("content_state_deleted_idx").on(t.deletedAt),
  check("content_state_kind_check", sql`"kind" IN ('media', 'season', 'episode')`),
  check("content_state_anime_movie_check", sql`NOT "is_anime_movie" OR "kind" = 'media'`),
]);
