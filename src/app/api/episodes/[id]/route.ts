import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson, text } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const body = await readJson(req);
    const [existing] = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!existing) throw new ApiError(404, "Episode not found");
    const updates: Partial<typeof episodes.$inferInsert> = {};
    if ("episodeNumber" in body) updates.episodeNumber = positiveId(body.episodeNumber, "episodeNumber");
    if ("title" in body) updates.title = text(body.title, "Episode title", 255);
    if ("duration" in body) updates.duration = text(body.duration, "Duration", 20);
    if ("seasonId" in body) {
      const seasonId = positiveId(body.seasonId, "seasonId");
      const [season] = await db.select().from(seasons).where(and(eq(seasons.id, seasonId), eq(seasons.mediaId, existing.mediaId))).limit(1);
      if (!season) throw new ApiError(400, "Season does not belong to this media item");
      updates.seasonId = seasonId;
    }
    const seasonId = updates.seasonId ?? existing.seasonId;
    const episodeNumber = updates.episodeNumber ?? existing.episodeNumber;
    const [duplicate] = await db.select({ id: episodes.id }).from(episodes).where(and(eq(episodes.seasonId, seasonId), eq(episodes.episodeNumber, episodeNumber), ne(episodes.id, id))).limit(1);
    if (duplicate) throw new ApiError(409, "That episode number already exists in this season");
    const [updated] = await db.update(episodes).set(updates).where(eq(episodes.id, id)).returning();
    return NextResponse.json(updated);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const [deleted] = await db.delete(episodes).where(eq(episodes.id, id)).returning({ id: episodes.id });
    if (!deleted) throw new ApiError(404, "Episode not found");
    return NextResponse.json({ success: true, objectRetained: true });
  } catch (error) { return errorResponse(error); }
}
