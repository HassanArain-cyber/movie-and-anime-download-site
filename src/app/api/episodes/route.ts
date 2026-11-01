import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, media, seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson, text } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const mediaId = positiveId(body.mediaId, "mediaId");
    const seasonId = positiveId(body.seasonId, "seasonId");
    const episodeNumber = positiveId(body.episodeNumber, "episodeNumber");
    const [season] = await db.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.mediaId, mediaId))).limit(1);
    if (!season) throw new ApiError(400, "Season does not belong to this media item");
    const [item] = await db.select({ type: media.type }).from(media).where(eq(media.id, mediaId)).limit(1);
    if (!item || item.type === "movie") throw new ApiError(400, "Episodes require anime or series");
    const [duplicate] = await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.seasonId, seasonId), eq(episodes.episodeNumber, episodeNumber))).limit(1);
    if (duplicate) throw new ApiError(409, "That episode number already exists in this season");
    const [ep] = await db.insert(episodes).values({ mediaId, seasonId, episodeNumber, title: text(body.title, "Episode title", 255), duration: text(body.duration, "Duration", 20) }).returning();
    return NextResponse.json(ep, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
