import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, episodes, media, seasons } from "@/db/schema";
import { getSearchCandidatePatterns, getSearchQueryForms, normalizeSearchText, rankSearchMatch, type SearchableContentType } from "./search";

export type EpisodeSearchInfo = {
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
};

export type MediaSearchResult = {
  id: number;
  type: SearchableContentType;
  title: string;
  slug: string;
  description: string | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  year: number | null;
  categoryId: number | null;
  categoryName: string | null;
  createdAt: Date | null;
  score: number;
  episodeInfo?: EpisodeSearchInfo;
};

type SearchOptions = {
  type?: string;
  categorySlug?: string;
  limit?: number;
  includeDescriptions?: boolean;
};

const MAX_QUERY_LENGTH = 120;
const MAX_TITLE_CANDIDATES = 350;
const MAX_EPISODE_CANDIDATES = 250;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function patternFor(term: string): string {
  return `%${escapeLike(term)}%`;
}

export async function searchMedia(query: string, options: SearchOptions = {}): Promise<MediaSearchResult[]> {
  const trimmed = query.trim();
  const normalizedQuery = normalizeSearchText(trimmed);
  if (!normalizedQuery || trimmed.length > MAX_QUERY_LENGTH || normalizedQuery.length < 2) return [];

  const directPatterns = getSearchCandidatePatterns(trimmed, { fuzzy: false });
  if (!directPatterns.length) return [];

  const selectedMedia = {
    id: media.id,
    type: media.type,
    title: media.title,
    slug: media.slug,
    description: media.description,
    posterUrl: media.posterUrl,
    thumbnailUrl: media.thumbnailUrl,
    year: media.year,
    categoryId: media.categoryId,
    categoryName: categories.name,
    createdAt: media.createdAt,
  };

  const fetchTitleRows = (patterns: string[]) => {
    const filters: SQL[] = [or(...patterns.map((pattern) => ilike(media.title, pattern)))!];
    if (options.type) filters.push(eq(media.type, options.type));
    if (options.categorySlug) filters.push(eq(categories.slug, options.categorySlug));
    const forms = getSearchQueryForms(trimmed).map((form) => sql`lower(${media.title}) = ${form.text}`);
    const exactOrder = sql`case when ${or(...forms)} then 0 else 1 end`;
    return db.select(selectedMedia)
      .from(media)
      .leftJoin(categories, eq(media.categoryId, categories.id))
      .where(and(...filters))
      .orderBy(asc(exactOrder), desc(media.createdAt), desc(media.id))
      .limit(MAX_TITLE_CANDIDATES);
  };

  const fetchEpisodeRows = (patterns: string[]) => {
    const episodeFilters: SQL[] = [or(...patterns.map((pattern) => ilike(episodes.title, pattern)))!];
    if (options.type) episodeFilters.push(eq(media.type, options.type));
    if (options.categorySlug) episodeFilters.push(eq(categories.slug, options.categorySlug));
    episodeFilters.push(sql`${media.type} in ('anime', 'series')`);
    return db.select({
      ...selectedMedia,
      seasonNumber: seasons.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeTitle: episodes.title,
    })
      .from(episodes)
      .innerJoin(media, eq(episodes.mediaId, media.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .leftJoin(categories, eq(media.categoryId, categories.id))
      .where(and(...episodeFilters))
      .orderBy(desc(media.createdAt), seasons.seasonNumber, episodes.episodeNumber, asc(episodes.id))
      .limit(MAX_EPISODE_CANDIDATES);
  };

  const ranked = new Map<number, MediaSearchResult>();
  const add = (row: Awaited<ReturnType<typeof fetchTitleRows>>[number], score: number, episodeInfo?: EpisodeSearchInfo) => {
    const type = row.type as SearchableContentType;
    if (type !== "movie" && type !== "anime" && type !== "series") return;
    const current = ranked.get(row.id);
    if (current && (current.score > score || (current.score === score && !current.episodeInfo))) return;
    ranked.set(row.id, { ...row, type, score, ...(episodeInfo ? { episodeInfo } : {}) });
  };

  const rankCandidates = async (patterns: string[]) => {
    const titleRows = await fetchTitleRows(patterns);
    for (const row of titleRows) {
      const match = rankSearchMatch(trimmed, row.title, "title");
      if (match) add(row, match.score);
    }

    const episodeRows = await fetchEpisodeRows(patterns);
    for (const row of episodeRows) {
      if (!row.episodeTitle) continue;
      const match = rankSearchMatch(trimmed, row.episodeTitle, "episode");
      if (!match) continue;
      const { seasonNumber, episodeNumber, episodeTitle, ...mediaRow } = row;
      add(mediaRow, match.score, { seasonNumber, episodeNumber, title: episodeTitle });
    }
  };

  // Most requests run only the small direct/alias candidate set. Broader fuzzy
  // patterns are queried only when it yields no ranked title or episode results.
  await rankCandidates(directPatterns);
  if (!ranked.size) {
    const directSet = new Set(directPatterns);
    const fuzzyPatterns = getSearchCandidatePatterns(trimmed).filter((pattern) => !directSet.has(pattern));
    if (fuzzyPatterns.length) await rankCandidates(fuzzyPatterns);
  }

  if (options.includeDescriptions) {
    const descriptionRows = await db.select(selectedMedia)
      .from(media)
      .leftJoin(categories, eq(media.categoryId, categories.id))
      .where(and(
        ...(options.type ? [eq(media.type, options.type)] : []),
        ...(options.categorySlug ? [eq(categories.slug, options.categorySlug)] : []),
        ilike(media.description, patternFor(trimmed)),
      ))
      .orderBy(desc(media.createdAt), desc(media.id))
      .limit(100);
    for (const row of descriptionRows) {
      const match = rankSearchMatch(trimmed, row.description ?? "", "description");
      if (match) add(row, match.score);
    }
  }

  const maximum = Math.max(1, Math.min(options.limit ?? 8, 120));
  return [...ranked.values()].sort((left, right) => right.score - left.score || right.id - left.id).slice(0, maximum);
}
