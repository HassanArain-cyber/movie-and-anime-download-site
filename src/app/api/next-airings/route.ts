import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

type AniListAiring = {
  id: number; isAdult: boolean; episodes: number | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
};
type ApiBody = { data?: { Page?: { media?: AniListAiring[] } }; errors?: unknown[] };

export async function GET(request: Request) {
  try {
    const input = new URL(request.url).searchParams.get("ids") || "";
    if (!/^\d+(?:,\d+){0,34}$/.test(input) || input.length > 400) throw new ApiError(400, "Provide up to 35 valid anime IDs");
    const ids = [...new Set(input.split(",").map(Number))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647)) throw new ApiError(400, "Invalid AniList ID");
    const query = `query VaultNextAirings($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: ANIME, isAdult: false) {
          id isAdult episodes nextAiringEpisode { episode airingAt }
        }
      }
    }`;
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { ids } }),
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new ApiError(503, "AniList schedule is temporarily unavailable");
    const body = await response.json() as ApiBody;
    if (body.errors?.length || !Array.isArray(body.data?.Page?.media)) throw new ApiError(503, "AniList schedule is temporarily unavailable");
    const now = Date.now();
    const results = body.data.Page.media.filter((m) =>
      !m.isAdult && m.nextAiringEpisode &&
      m.nextAiringEpisode.airingAt * 1000 > now
    ).map((m) => ({
      anilistId: m.id,
      episode: m.nextAiringEpisode!.episode,
      airingAt: new Date(m.nextAiringEpisode!.airingAt * 1000).toISOString(),
      totalEpisodes: m.episodes,
    }));
    return NextResponse.json({ airings: results, asOf: new Date().toISOString() }, {
      headers: { "Cache-Control": "private, max-age=0" },
    });
  } catch (error) { return errorResponse(error); }
}
