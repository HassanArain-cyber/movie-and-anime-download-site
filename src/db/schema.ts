import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Media categories (e.g. Action, Drama, Anime)
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
});

// Media: movies, anime, tv series
export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // 'movie' | 'anime' | 'series'
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

// Seasons for series/anime
export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  name: varchar("name", { length: 255 }),
});

// Episodes within a season
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
  duration: varchar("duration", { length: 20 }), // e.g. "24m"
});

// Download links: attached to a movie OR an episode
export const downloadLinks = pgTable("download_links", {
  id: serial("id").primaryKey(),
  mediaId: integer("media_id").references(() => media.id, {
    onDelete: "cascade",
  }),
  episodeId: integer("episode_id").references(() => episodes.id, {
    onDelete: "cascade",
  }),
  label: varchar("label", { length: 50 }).default("Download"),
  url: text("url").notNull(),
  fileSize: varchar("file_size", { length: 30 }),
  isUploaded: boolean("is_uploaded").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const mediaRelations = relations(media, ({ one, many }) => ({
  category: one(categories, {
    fields: [media.categoryId],
    references: [categories.id],
  }),
  seasons: many(seasons),
  downloadLinks: many(downloadLinks),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  media: one(media, { fields: [seasons.mediaId], references: [media.id] }),
  episodes: many(episodes),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  media: one(media, { fields: [episodes.mediaId], references: [media.id] }),
  season: one(seasons, { fields: [episodes.seasonId], references: [seasons.id] }),
  downloadLinks: many(downloadLinks),
}));

export const downloadLinksRelations = relations(downloadLinks, ({ one }) => ({
  media: one(media, { fields: [downloadLinks.mediaId], references: [media.id] }),
  episode: one(episodes, {
    fields: [downloadLinks.episodeId],
    references: [episodes.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  media: many(media),
}));
