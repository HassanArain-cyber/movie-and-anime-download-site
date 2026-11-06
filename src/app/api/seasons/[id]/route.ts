import { assertActiveContent } from "@/lib/content-state";
import { moveToBin } from "@/lib/recycle-bin";
import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson, text } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    await assertActiveContent("season", id);
    const body = await readJson(req);
    const [existing] = await db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
    if (!existing) throw new ApiError(404, "Season not found");
    const updates: Partial<typeof seasons.$inferInsert> = {};
    if ("seasonNumber" in body) updates.seasonNumber = positiveId(body.seasonNumber, "seasonNumber");
    if ("name" in body) updates.name = text(body.name, "Season name", 255);
    if (updates.seasonNumber !== undefined) {
      const [duplicate] = await db.select({ id: seasons.id }).from(seasons).where(and(eq(seasons.mediaId, existing.mediaId), eq(seasons.seasonNumber, updates.seasonNumber), ne(seasons.id, id))).limit(1);
      if (duplicate) throw new ApiError(409, "That season number already exists for this title");
    }
    const [updated] = await db.update(seasons).set(updates).where(eq(seasons.id, id)).returning();
    return NextResponse.json(updated);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    await moveToBin("season", id);
    return NextResponse.json({ success: true, objectRetained: true });
  } catch (error) { return errorResponse(error); }
}
