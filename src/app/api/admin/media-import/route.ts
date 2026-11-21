import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Candidate = {
  title: string; description: string; posterUrl: string | null;
  year: number | null; genres: string; episodeCount: number | null;
  externalSource: "anilist" | "tmdb" | "tvmaze"; externalId: string;
};
type AniListMedia = {
  id: number; isAdult: boolean; title: { english: string | null; romaji: string | null };
  description: string | null; seasonYear: number | null; episodes: number | null;
  startDate: { year: number | null } | null; coverImage: { large: string | null; extraLarge: string | null };
  genres: string[] | null;
};
const ANILIST_QUERY = `query VaultImport($search: String!) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
      id isAdult title { english romaji } description(asHtml: false)
      seasonYear startDate { year } episodes genres coverImage { large extraLarge }
    }
  }
}`;
const timeout = 7000;

function plain(value: unknown, max = 1500): string {
  if (typeof value !== "string") return "";
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
const safeYear = (v: unknown) => typeof v === "number" && v >= 1800 && v <= 2200 ? v : null;
const positive = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10000 ? v : null;
const genres = (values: unknown) => Array.isArray(values) ? values.filter((x): x is string => typeof x === "string").slice(0, 10).join(", ").slice(0, 500) : "";
function picture(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username ? parsed.href : null; }
  catch { return null; }
}
async function getAnime(q: string): Promise<Candidate[]> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: q } }),
    next: { revalidate: 3600 }, signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new ApiError(503, "AniList lookup temporarily unavailable");
  const data = await res.json() as { data?: { Page?: { media?: AniListMedia[] } }; errors?: unknown[] };
  if (data.errors?.length || !data.data?.Page?.media) throw new ApiError(503, "AniList lookup failed");
  return data.data.Page.media.filter((m) => m.isAdult === false).map((m) => ({
    title: plain(m.title.english || m.title.romaji, 255),
    description: plain(m.description, 20000),
    posterUrl: picture(m.coverImage?.extraLarge || m.coverImage?.large),
    year: safeYear(m.seasonYear ?? m.startDate?.year),
    genres: genres(m.genres), episodeCount: positive(m.episodes),
    externalSource: "anilist" as const, externalId: String(m.id),
  })).filter((m) => m.title);
}
type TVMazeShow = {
  id: number; name: string; summary: string | null; premiered: string | null;
  genres: string[]; image: { original: string | null; medium: string | null } | null;
  weight?: number;
};
async function getShows(q: string): Promise<Candidate[]> {
  const res = await fetch("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(q), {
    headers: { Accept: "application/json" }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new ApiError(503, "TVmaze lookup temporarily unavailable");
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new ApiError(503, "Invalid TVmaze lookup response");
  return data.slice(0, 8).map((r): Candidate | null => {
    const show = (r as { show?: TVMazeShow })?.show;
    if (!show?.id || !show.name) return null;
    return { title: plain(show.name, 255), description: plain(show.summary, 20000),
      posterUrl: picture(show.image?.original || show.image?.medium),
      year: show.premiered ? safeYear(Number(show.premiered.slice(0, 4))) : null,
      genres: genres(show.genres), episodeCount: null, externalSource: "tvmaze", externalId: String(show.id) };
  }).filter((r): r is Candidate => r !== null);
}
type TMDBMovie = {
  id: number; title: string; overview: string; release_date: string;
  poster_path: string | null; genre_ids: number[]; adult: boolean;
};
async function getMovies(q: string, token: string, apiKey: boolean): Promise<Candidate[]> {
  const params = new URLSearchParams({ query: q, include_adult: "false", language: "en-US", page: "1" });
  if (apiKey) params.set("api_key", token);
  const head: Record<string, string> = apiKey ? {} : { Authorization: "Bearer " + token };
  const [search, genreResp] = await Promise.all([
    fetch("https://api.themoviedb.org/3/search/movie?" + params, { headers: head, next: { revalidate: 3600 }, signal: AbortSignal.timeout(timeout) }),
    fetch("https://api.themoviedb.org/3/genre/movie/list?" + new URLSearchParams(apiKey ? { api_key: token, language: "en-US" } : { language: "en-US" }), { headers: head, next: { revalidate: 86400 }, signal: AbortSignal.timeout(timeout) }),
  ]);
  if (!search.ok) throw new ApiError(503, "TMDB movie lookup temporarily unavailable");
  const body = await search.json() as { results?: TMDBMovie[] };
  const genreBody = genreResp.ok ? await genreResp.json() as { genres?: { id: number; name: string }[] } : { genres: [] };
  const names = new Map((genreBody.genres ?? []).map((g) => [g.id, g.name]));
  return (body.results ?? []).filter((m) => m.adult === false).slice(0, 8).map((m) => ({
    title: plain(m.title, 255), description: plain(m.overview, 20000),
    posterUrl: m.poster_path?.startsWith("/") ? picture("https://image.tmdb.org/t/p/w500" + m.poster_path) : null,
    year: safeYear(Number(m.release_date?.slice(0, 4))),
    genres: genres((m.genre_ids || []).map((id) => names.get(id)).filter(Boolean)),
    episodeCount: null, externalSource: "tmdb" as const, externalId: String(m.id),
  })).filter((m) => m.title);
}
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!["anime", "movie", "series"].includes(type || "")) throw new ApiError(400, "Choose a media type");
    if (query.length < 2 || query.length > 100) throw new ApiError(400, "Search using 2–100 characters");
    let results: Candidate[];
    if (type === "anime") results = await getAnime(query);
    else if (type === "series") results = await getShows(query);
    else {
      const token = process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY;
      if (!token) return NextResponse.json({ results: [], configured: false, provider: "tmdb",
        message: "Movie search requires a free TMDB API token in TMDB_READ_TOKEN (Vercel project settings)." });
      results = await getMovies(query, token, !process.env.TMDB_READ_TOKEN);
    }
    return NextResponse.json({ results, configured: true, provider: type === "anime" ? "anilist" : type === "series" ? "tvmaze" : "tmdb" },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
