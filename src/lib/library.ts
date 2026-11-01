import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { categories, downloadLinks, episodes, media, seasons } from "@/db/schema";
import { ApiError, optionalId, quality as parseQuality } from "./validation";
import type { DownloadLink, EpisodeWithLinks, MediaWithRelations, SeasonWithEpisodes, StorageProvider, VideoQuality } from "./types";
import type { UploadTarget } from "./storage";

export async function resolveTarget(body: Record<string, unknown>, allowImageWithoutTarget = false, allowTitleLevel = false): Promise<UploadTarget> {
  let mediaId = optionalId(body.mediaId, "mediaId");
  let seasonId = optionalId(body.seasonId, "seasonId");
  const episodeId = optionalId(body.episodeId, "episodeId");
  const selectedQuality = parseQuality(body.quality);

  if (episodeId !== null) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
    if (!episode) throw new ApiError(404, "Episode not found");
    if (mediaId !== null && mediaId !== episode.mediaId) throw new ApiError(400, "Episode belongs to a different media item");
    if (seasonId !== null && seasonId !== episode.seasonId) throw new ApiError(400, "Episode belongs to a different season");
    mediaId = episode.mediaId;
    seasonId = episode.seasonId;
  }
  if (seasonId !== null) {
    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
    if (!season) throw new ApiError(404, "Season not found");
    if (mediaId !== null && mediaId !== season.mediaId) throw new ApiError(400, "Season belongs to a different media item");
    mediaId = season.mediaId;
  }
  if (mediaId === null) {
    if (allowImageWithoutTarget && seasonId === null && episodeId === null) return { mediaId: null, seasonId: null, episodeId: null, quality: null };
    throw new ApiError(400, "Choose a movie, season, or episode");
  }
  const [item] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!item) throw new ApiError(404, "Media not found");
  if (item.type === "movie" && (seasonId !== null || episodeId !== null)) throw new ApiError(400, "Movies cannot contain seasons or episodes");
  if (item.type !== "movie" && seasonId === null && !allowImageWithoutTarget && !allowTitleLevel) throw new ApiError(400, "Choose a season or episode for this anime/series");
  if (allowImageWithoutTarget && (seasonId !== null || episodeId !== null || selectedQuality !== null)) throw new ApiError(400, "Poster uploads attach to a media item, not an episode or quality");
  return { mediaId, seasonId, episodeId, quality: selectedQuality };
}

function normalizeLink(row: typeof downloadLinks.$inferSelect): DownloadLink {
  return { ...row, quality: row.quality as VideoQuality | null, storageProvider: row.storageProvider as StorageProvider | null };
}

/** Four bounded queries instead of one query per episode. */
export async function getMediaDetails(mediaId: number): Promise<MediaWithRelations> {
  const [item] = await db.select({
    id: media.id, type: media.type, title: media.title, slug: media.slug,
    description: media.description, posterUrl: media.posterUrl, thumbnailUrl: media.thumbnailUrl,
    year: media.year, categoryId: media.categoryId, categoryName: categories.name,
    createdAt: media.createdAt, updatedAt: media.updatedAt,
  }).from(media).leftJoin(categories, eq(media.categoryId, categories.id)).where(eq(media.id, mediaId)).limit(1);
  if (!item) throw new ApiError(404, "Media not found");
  const seasonRows = await db.select().from(seasons).where(eq(seasons.mediaId, mediaId)).orderBy(seasons.seasonNumber, seasons.id);
  const episodeRows = await db.select().from(episodes).where(eq(episodes.mediaId, mediaId)).orderBy(episodes.episodeNumber, episodes.id);
  const conditions = [eq(downloadLinks.mediaId, mediaId)];
  if (seasonRows.length) conditions.push(inArray(downloadLinks.seasonId, seasonRows.map((row) => row.id)));
  if (episodeRows.length) conditions.push(inArray(downloadLinks.episodeId, episodeRows.map((row) => row.id)));
  const linkRows = (await db.select().from(downloadLinks).where(or(...conditions)).orderBy(downloadLinks.createdAt, downloadLinks.id)).map(normalizeLink);
  const episodeMap = new Map<number, EpisodeWithLinks>();
  for (const episode of episodeRows) episodeMap.set(episode.id, { ...episode, downloadLinks: linkRows.filter((link) => link.episodeId === episode.id) });
  const seasonList: SeasonWithEpisodes[] = seasonRows.map((season) => ({
    ...season,
    episodes: [...episodeMap.values()].filter((episode) => episode.seasonId === season.id),
    downloadLinks: linkRows.filter((link) => link.seasonId === season.id && link.episodeId === null),
  }));
  return {
    ...item,
    type: item.type as MediaWithRelations["type"],
    seasons: seasonList,
    downloadLinks: linkRows.filter((link) => link.episodeId === null && link.seasonId === null),
  };
}
