import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media, seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson, text } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const mediaId = positiveId(body.mediaId, "mediaId");
    const seasonNumber = positiveId(body.seasonNumber, "seasonNumber");
    const [item] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
    if (!item) throw new ApiError(404, "Media not found");
    if (item.type === "movie") throw new ApiError(400, "Movies cannot have seasons");
    const [duplicate] = await db.select({ id: seasons.id }).from(seasons).where(and(eq(seasons.mediaId, mediaId), eq(seasons.seasonNumber, seasonNumber))).limit(1);
    if (duplicate) throw new ApiError(409, "That season number already exists for this title");
    const [season] = await db.insert(seasons).values({ mediaId, seasonNumber, name: text(body.name, "Season name", 255) }).returning();
    return NextResponse.json(season, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
