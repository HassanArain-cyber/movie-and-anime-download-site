import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { episodes, media, seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson, text } from "@/lib/validation";

// Create a complete season's episode rows in one transaction. Existing rows are
// never overwritten; conflicting numbers are reported before any insert.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const seasonId = positiveId(body.seasonId, "seasonId");
    const start = positiveId(body.start ?? 1, "start");
    const count = positiveId(body.count, "count");
    if (count > 500) throw new ApiError(400, "Add at most 500 episodes per batch");
    if (start + count - 1 > 100000) throw new ApiError(400, "Episode numbers are too large");
    const prefix = text(body.titlePrefix, "Title prefix", 200) || "Episode";
    const duration = text(body.duration, "Duration", 20);
    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId)).limit(1);
    if (!season) throw new ApiError(404, "Season not found");
    const [item] = await db.select({ type: media.type }).from(media).where(eq(media.id, season.mediaId)).limit(1);
    if (!item || item.type === "movie") throw new ApiError(400, "Episodes require anime or series");
    const numbers = Array.from({ length: count }, (_, i) => start + i);
    const created = await db.transaction(async (tx) => {
      const existing = await tx.select({ episodeNumber: episodes.episodeNumber }).from(episodes)
        .where(and(eq(episodes.seasonId, seasonId), inArray(episodes.episodeNumber, numbers)));
      if (existing.length) throw new ApiError(409, `Episode numbers already exist: ${existing.map((e) => e.episodeNumber).join(", ")}. No episodes were added.`);
      return tx.insert(episodes).values(numbers.map((episodeNumber) => ({ mediaId: season.mediaId, seasonId, episodeNumber, title: `${prefix} ${episodeNumber}`, duration }))).returning();
    });
    return NextResponse.json({ episodes: created }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
