import { assertActiveContent } from "@/lib/content-state";
import { requireLifecycle, lifecycleReady } from "@/lib/content-state";
import { moveToBin } from "@/lib/recycle-bin";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, categories, seasons, contentState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getMediaDetails } from "@/lib/library";
import { uniqueSlug } from "@/lib/slugs";
import { ApiError, errorResponse, imageUrl, mediaType, optionalId, positiveId, readJson, text, year } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  try { return NextResponse.json(await getMediaDetails(positiveId((await params).id))); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    await assertActiveContent("media", id);
    const body = await readJson(req);
    const [existing] = await db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!existing) throw new ApiError(404, "Media not found");
    const updates: Partial<typeof media.$inferInsert> = { updatedAt: new Date() };
    if ("type" in body) {
      updates.type = mediaType(body.type);
      if (updates.type === "movie" && existing.type !== "movie") {
        const [season] = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.mediaId, id)).limit(1);
        if (season) throw new ApiError(409, "Cannot change a title with seasons to a movie; the existing seasons and episodes would become inaccessible. Remove or reassign them first.");
      }
    }
    if ("title" in body) {
      updates.title = text(body.title, "Title", 255, true)!;
      if (updates.title !== existing.title) updates.slug = await uniqueSlug(updates.title, id);
    }
    if ("description" in body) updates.description = text(body.description, "Description", 20000);
    if ("posterUrl" in body) updates.posterUrl = imageUrl(body.posterUrl, "Poster URL");
    if ("thumbnailUrl" in body) updates.thumbnailUrl = imageUrl(body.thumbnailUrl, "Thumbnail URL");
    if ("year" in body) updates.year = year(body.year);
    if ("commentsEnabled" in body) {
      if (typeof body.commentsEnabled !== "boolean") throw new ApiError(400, "commentsEnabled must be true or false");
      updates.commentsEnabled = body.commentsEnabled;
    }
    if ("categoryId" in body) {
      const categoryId = optionalId(body.categoryId, "categoryId");
      if (categoryId !== null) {
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
        if (!category) throw new ApiError(400, "Category not found");
      }
      updates.categoryId = categoryId;
    }
    if ("isAnimeMovie" in body) {
      if (typeof body.isAnimeMovie !== "boolean" || (body.isAnimeMovie && (updates.type ?? existing.type) !== "movie")) throw new ApiError(400, "Anime movie classification requires a standalone movie");
      await requireLifecycle();
    }
    const resetFlag = updates.type !== undefined && updates.type !== "movie" && await lifecycleReady();
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(media).set(updates).where(eq(media.id, id)).returning();
      if (!row) throw new ApiError(404, "Not found");
      if ("isAnimeMovie" in body || resetFlag) {
        const flag = resetFlag ? false : body.isAnimeMovie as boolean;
        await tx.insert(contentState).values({ kind: "media", contentId: id, isAnimeMovie: flag }).onConflictDoUpdate({ target: [contentState.kind, contentState.contentId], set: { isAnimeMovie: flag } });
      }
      return row;
    });
    return NextResponse.json(updated);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    await moveToBin("media", id);
    return NextResponse.json({ success: true, objectRetained: true });
  } catch (error) { return errorResponse(error); }
}
