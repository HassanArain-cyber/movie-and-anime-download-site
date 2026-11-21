import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

type AniListMedia = {
  id: number;
  isAdult: boolean;
  title?: { english?: string | null; romaji?: string | null };
  coverImage?: { medium?: string | null };
  episodes?: number | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
};
type AniListBody = { data?: { Page?: { media?: AniListMedia[] } }; errors?: unknown[] };

const QUERY = String.raw`query VaultCalendarSearch($search: String) {
  Page(page: 1, perPage: 12) {
    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
      id isAdult title { english romaji } coverImage { medium }
      episodes nextAiringEpisode { episode airingAt }
    }
  }
}`;

function safePoster(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  try {
    const search = (new URL(request.url).searchParams.get("q") || "").trim();
    if (search.length < 2 || search.length > 80 || /[\u0000-\u001f\u007f]/.test(search)) {
      throw new ApiError(400, "Enter an anime title (2–80 characters)");
    }
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { search } }),
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new ApiError(503, "Anime search is temporarily unavailable");
    const body = await response.json() as AniListBody;
    if (body.errors?.length || !Array.isArray(body.data?.Page?.media)) {
      throw new ApiError(503, "Anime search is temporarily unavailable");
    }
    const now = Date.now();
    const results = body.data.Page.media.filter((media) =>
      media.isAdult === false && Number.isSafeInteger(media.id) && media.id > 0 && media.id <= 2147483647
    ).map((media) => {
      const title = media.title?.english || media.title?.romaji || "";
      const next = media.nextAiringEpisode;
      const validNext = next && Number.isInteger(next.episode) && next.episode > 0 &&
        Number.isFinite(next.airingAt) && next.airingAt * 1000 > now;
      return {
        id: media.id,
        title: title.slice(0, 200),
        posterUrl: safePoster(media.coverImage?.medium),
        totalEpisodes: Number.isInteger(media.episodes) && Number(media.episodes) > 0 ? media.episodes : null,
        nextAiring: validNext ? { episode: next.episode, airingAt: new Date(next.airingAt * 1000).toISOString() } : null,
      };
    }).filter((media) => media.title.trim()).slice(0, 12);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
