import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, media, seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { assertActiveContent } from "@/lib/content-state";
import { numberedEpisodeDrafts, tvmazeEpisodeDrafts } from "@/lib/episode-suggestions";
import { ApiError, errorResponse, positiveId } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;

  try {
    const params = new URL(request.url).searchParams;
    const seasonId = positiveId(params.get("seasonId"), "seasonId");
    await assertActiveContent("season", seasonId);
    const [season] = await db.select({
      id: seasons.id, seasonNumber: seasons.seasonNumber,
      mediaId: seasons.mediaId,
    }).from(seasons).where(eq(seasons.id, seasonId)).limit(1);
    if (!season) throw new ApiError(404, "Season not found");

    const [title] = await db.select({
      type: media.type, externalSource: media.externalSource,
      externalId: media.externalId, episodeCount: media.episodeCount,
    }).from(media).where(eq(media.id, season.mediaId)).limit(1);
    if (!title || title.type === "movie") throw new ApiError(400, "Choose an anime or TV series");

    const saved = await db.select({ episodeNumber: episodes.episodeNumber })
      .from(episodes).where(and(eq(episodes.seasonId, season.id), eq(episodes.mediaId, season.mediaId)));
    const existing = saved.map((row) => row.episodeNumber);

    if (title.type === "series" && title.externalSource === "tvmaze" &&
      title.externalId && /^[1-9]\d{0,9}$/.test(title.externalId)) {
      const response = await fetch("https://api.tvmaze.com/shows/" + title.externalId + "/episodes", {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new ApiError(503, "TVmaze episode information is temporarily unavailable");
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new ApiError(503, "TVmaze returned an invalid episode list");
      return NextResponse.json({
        suggestions: tvmazeEpisodeDrafts(data, season.seasonNumber, existing),
        source: "tvmaze",
        message: "Episode names and durations are from TVmaze. Review them before saving.",
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    // AniList totals do not provide confirmed names for individual episodes.
    // Restrict numbered drafts to season 1 to avoid reusing a season's total in sequels.
    if (title.type === "anime" && season.seasonNumber === 1 && title.episodeCount) {
      return NextResponse.json({
        suggestions: numberedEpisodeDrafts(title.episodeCount, existing),
        source: "numbered",
        message: "Numbered drafts from the known total only. Episode titles and availability are not confirmed.",
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    return NextResponse.json({
      suggestions: [], source: "none",
      message: "No episode list is available from the saved metadata. Add episode rows manually.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
