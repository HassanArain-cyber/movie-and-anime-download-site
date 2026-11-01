import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getMediaDetails } from "@/lib/library";
import { uniqueSlug } from "@/lib/slugs";
import { ApiError, errorResponse, mediaType, optionalId, positiveId, readJson, text, year } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  try { return NextResponse.json(await getMediaDetails(positiveId((await params).id))); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const body = await readJson(req);
    const [existing] = await db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!existing) throw new ApiError(404, "Media not found");
    const updates: Partial<typeof media.$inferInsert> = { updatedAt: new Date() };
    if ("type" in body) updates.type = mediaType(body.type);
    if ("title" in body) {
      updates.title = text(body.title, "Title", 255, true)!;
      if (updates.title !== existing.title) updates.slug = await uniqueSlug(updates.title, id);
    }
    if ("description" in body) updates.description = text(body.description, "Description", 20000);
    if ("posterUrl" in body) updates.posterUrl = text(body.posterUrl, "Poster URL", 8192);
    if ("thumbnailUrl" in body) updates.thumbnailUrl = text(body.thumbnailUrl, "Thumbnail URL", 8192);
    if ("year" in body) updates.year = year(body.year);
    if ("categoryId" in body) {
      const categoryId = optionalId(body.categoryId, "categoryId");
      if (categoryId !== null) {
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
        if (!category) throw new ApiError(400, "Category not found");
      }
      updates.categoryId = categoryId;
    }
    const [updated] = await db.update(media).set(updates).where(eq(media.id, id)).returning();
    return NextResponse.json(updated);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_req: Request, { params }: Context) {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const [deleted] = await db.delete(media).where(eq(media.id, id)).returning({ id: media.id });
    if (!deleted) throw new ApiError(404, "Media not found");
    // Existing relational cascade is unchanged. R2 objects are never deleted here.
    return NextResponse.json({ success: true, objectRetained: true });
  } catch (error) { return errorResponse(error); }
}
