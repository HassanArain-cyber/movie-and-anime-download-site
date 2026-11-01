import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  varchar,
  boolean,
  bigint,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
