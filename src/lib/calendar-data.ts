import "server-only";
import { and, gte, lt, eq, asc } from "drizzle-orm";
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
  }));
  return {
    year, month,
    events: combineCalendarEvents([...live.events, ...vaultEvents], manual, year, month),
    anilistStatus: live.status,
    updatedAt: new Date().toISOString(),
    timeZone: "Asia/Karachi",
  };
}
