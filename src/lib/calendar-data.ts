import "server-only";
import { and, gte, lt, eq, asc, inArray } from "drizzle-orm";
import { activeContent } from "@/lib/content-state";
import { db } from "@/db";
import { episodePublications, media } from "@/db/schema";
import { calendarWindow, combineCalendarEvents, type CalendarEvent, type CalendarResponse } from "@/lib/calendar-model";
import { getExternalCalendar } from "@/lib/calendar-feed";
import { getManualCalendarEntries } from "@/lib/calendar-store";

export async function getCalendarData(year: number, month: number): Promise<CalendarResponse> {
  const { start, end } = calendarWindow(year, month);
  const [manual, published, live] = await Promise.all([
    getManualCalendarEntries(),
    db.select({
      episodeId: episodePublications.episodeId,
      mediaId: episodePublications.mediaId,
      title: episodePublications.title,
      episode: episodePublications.episodeNumber,
      airingAt: episodePublications.publishedAt,
      posterUrl: media.posterUrl,
      url: episodePublications.url,
    }).from(episodePublications)
      .leftJoin(media, eq(episodePublications.mediaId, media.id))
      .where(and(gte(episodePublications.publishedAt, start), lt(episodePublications.publishedAt, end)))
      .orderBy(asc(episodePublications.publishedAt)).limit(300),
    year >= 2020 && year <= 2037
      ? getExternalCalendar(year, month)
      : Promise.resolve({ events: [] as CalendarEvent[], status: "disabled" as const }),
  ]);
  const vaultEvents: CalendarEvent[] = published.map((episode) => ({
    id: "vault:" + episode.episodeId,
    title: episode.title,
    kind: "episode",
    airingAt: episode.airingAt.toISOString(),
    episode: episode.episode,
    totalEpisodes: null,
    posterUrl: episode.posterUrl,
    url: /^\/(?:anime|series|movie)\/[a-z0-9-]+(?:#episode-\d+)?$/i.test(episode.url) ? episode.url : null,
    source: "vault",
    notes: "Available on Vault",
    anilistId: null,
    vaultMediaId: episode.mediaId,
  }));
  const events = combineCalendarEvents([...live.events, ...vaultEvents], manual, year, month);
  // A single bounded DB lookup maps public airing IDs to real Vault records.
  // It does not try to match anime by fuzzy titles (remakes/seasons may differ).
  const sourceIds = [...new Set(events.filter((item) => Number.isSafeInteger(item.anilistId) && item.anilistId! > 0)
    .map((item) => String(item.anilistId)))];
  const matching = sourceIds.length ? await db.select({ id: media.id, externalId: media.externalId })
    .from(media).where(and(eq(media.type, "anime"), eq(media.externalSource, "anilist"),
      inArray(media.externalId, sourceIds), await activeContent("media", media.id)))
    .limit(500) : [];
  const bySourceId = new Map(matching.map((item) => [item.externalId, item.id]));
  const enriched = events.map((item) => item.anilistId
    ? { ...item, vaultMediaId: bySourceId.get(String(item.anilistId)) ?? null }
    : item);
  return {
    year, month,
    events: enriched,
    anilistStatus: live.status,
    updatedAt: new Date().toISOString(),
    timeZone: "Asia/Karachi",
  };
}
