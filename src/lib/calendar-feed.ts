import "server-only";
import { calendarWindow, type CalendarEvent } from "@/lib/calendar-model";

type FeedResult = {
  events: CalendarEvent[];
  status: "ok" | "partial" | "unavailable" | "fallback" | "disabled";
};

type AnilistSchedule = {
  id: number;
  airingAt: number;
  episode: number;
  media?: {
    id: number;
    isAdult: boolean;
    episodes: number | null;
    status: string | null;
    nextAiringEpisode: { episode: number; airingAt: number } | null;
    siteUrl: string | null;
    title: { english: string | null; romaji: string | null };
    coverImage: { large: string | null };
  } | null;
};
type AniListPage = { data?: { Page?: { airingSchedules?: AnilistSchedule[]; pageInfo?: { hasNextPage: boolean } } }; errors?: Array<{ message?: string }> };
const QUERY = `query VaultCalendar($start: Int, $end: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      id episode airingAt
      media { id isAdult episodes status nextAiringEpisode { episode airingAt } siteUrl title { english romaji } coverImage { large } }
    }
  }
}`;

function safePublicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; }
  catch { return null; }
}

async function fetchAniList(year: number, month: number): Promise<FeedResult> {
  const range = calendarWindow(year, month);
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  let more = false;
  // A bounded page budget and half-hour caching protect AniList's rate limits.
  for (let page = 1; page <= 8; page++) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { start: Math.floor(range.start.getTime() / 1000), end: Math.ceil(range.end.getTime() / 1000), page },
      }),
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error("AniList returned " + response.status);
    const data = await response.json() as AniListPage;
    if (data.errors?.length || !data.data?.Page?.airingSchedules) throw new Error("AniList did not return a valid airing schedule");
    for (const slot of data.data.Page.airingSchedules) {
      const anime = slot.media;
      if (!anime || anime.isAdult !== false || !Number.isSafeInteger(slot.episode) || slot.episode < 1 || !Number.isFinite(slot.airingAt)) continue;
      const title = anime.title?.english || anime.title?.romaji;
      if (!title || title.length > 200) continue;
      const key = String(anime.id) + ":" + String(slot.episode);
      if (seen.has(key)) continue;
      seen.add(key);
      const next = anime.nextAiringEpisode;
      const aired = next && Number.isInteger(next.episode) && next.airingAt * 1000 > Date.now()
        ? Math.max(0, next.episode - 1)
        : anime.status === "FINISHED" && Number.isInteger(anime.episodes) ? anime.episodes : null;
      events.push({
        id: "anilist:" + String(slot.id),
        title,
        kind: "episode",
        airingAt: new Date(slot.airingAt * 1000).toISOString(),
        episode: slot.episode,
        totalEpisodes: Number.isInteger(anime.episodes) && Number(anime.episodes) > 0 ? anime.episodes : null,
        airedEpisodes: aired,
        posterUrl: safePublicUrl(anime.coverImage?.large),
        url: safePublicUrl(anime.siteUrl) ?? "https://anilist.co/anime/" + anime.id,
        source: "anilist",
        notes: null,
        anilistId: anime.id,
      });
    }
    more = data.data.Page.pageInfo?.hasNextPage === true;
    if (!more) break;
  }
  return { events, status: more ? "partial" : "ok" };
}

type JikanAnime = {
  mal_id: number;
  title: string;
  url?: string;
  episodes?: number | null;
  rating?: string | null;
  images?: { jpg?: { image_url?: string } };
  broadcast?: { day?: string | null; time?: string | null; timezone?: string | null };
};
type JikanPage = { data?: JikanAnime[]; pagination?: { has_next_page?: boolean } };
const DAYS = ["sundays", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays"];

/** MAL's Jikan API provides weekly broadcast slots, NOT reliable next episode numbers.
 * The fallback is visibly labelled as a weekly schedule rather than a confirmed episode.
 */
async function fetchJikanFallback(): Promise<FeedResult> {
  const list: JikanAnime[] = [];
  for (let page = 1; page <= 4; page++) {
    const response = await fetch("https://api.jikan.moe/v4/schedules?page=" + page + "&limit=25", {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error("Jikan returned " + response.status);
    const data = await response.json() as JikanPage;
    if (!Array.isArray(data.data)) throw new Error("Jikan did not return a valid schedule");
    list.push(...data.data);
    if (!data.pagination?.has_next_page) break;
  }
  const events: CalendarEvent[] = [];
  // MAL's weekly grid describes CURRENT broadcasts. Projecting it through
  // arbitrary future/past months would invent releases. Show the next 14 days only.
  const tokyoDateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (key: string) => Number(tokyoDateParts.find((value) => value.type === key)?.value);
  const now = Date.now();
  const first = Date.UTC(part("year"), part("month") - 1, part("day"));
  for (const anime of list) {
    const day = DAYS.indexOf(String(anime.broadcast?.day || "").toLowerCase());
    const time = anime.broadcast?.time?.match(/^(\d{1,2}):(\d{2})$/);
    if (day < 0 || !time || anime.broadcast?.timezone !== "Asia/Tokyo") continue;
    if (!anime.mal_id || !anime.title || /^r(?:\+|-17|x)/i.test(anime.rating ?? "")) continue;
    const hour = Number(time[1]), minute = Number(time[2]);
    if (hour > 23 || minute > 59) continue;
    for (let offset = -1; offset <= 14; offset++) {
      const dateUtc = first + offset * 86_400_000;
      if (new Date(dateUtc).getUTCDay() !== day) continue;
      const instant = dateUtc + (hour - 9) * 3_600_000 + minute * 60_000;
      if (instant < now - 86_400_000 || instant > now + 14 * 86_400_000) continue;
      const iso = new Date(instant).toISOString();
      events.push({
        id: "jikan:" + anime.mal_id + ":" + iso.slice(0, 10),
        title: anime.title,
        kind: "episode",
        airingAt: iso,
        episode: null,
        totalEpisodes: Number.isInteger(anime.episodes) && Number(anime.episodes) > 0 ? anime.episodes! : null,
        posterUrl: safePublicUrl(anime.images?.jpg?.image_url),
        url: safePublicUrl(anime.url) ?? "https://myanimelist.net/anime/" + anime.mal_id,
        source: "jikan",
        notes: "Estimated weekly slot · episode number and exact release not confirmed",
        anilistId: null,
      });
    }
  }
  return { events, status: "fallback" };
}

export async function getExternalCalendar(year: number, month: number): Promise<FeedResult> {
  if (process.env.CALENDAR_DISABLE_EXTERNAL === "1") return { events: [], status: "disabled" };
  try { return await fetchAniList(year, month); }
  catch (error) {
    console.warn("[calendar] AniList unavailable; checking MAL weekly fallback:", error instanceof Error ? error.message : "Unknown error");
    try { return await fetchJikanFallback(); }
    catch (fallbackError) {
      console.warn("[calendar] MAL fallback unavailable:", fallbackError instanceof Error ? fallbackError.message : "Unknown error");
      return { events: [], status: "unavailable" };
    }
  }
}
