import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, categories } from "@/db/schema";
import { eq, ilike, or, and, desc, type SQL } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getMediaDetails } from "@/lib/library";
import { uniqueSlug } from "@/lib/slugs";
import { errorResponse, imageUrl, mediaType, optionalId, readJson, text, year } from "@/lib/validation";
import { searchMedia } from "@/lib/media-search";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category");
  const slug = searchParams.get("slug");
  const suggestionsOnly = searchParams.get("suggestions") === "1";
  try {
    if (suggestionsOnly) {
      const suggestions = q
        ? await searchMedia(q, { type: type ?? undefined, categorySlug: category ?? undefined, limit: 8 })
        : [];
      return NextResponse.json(suggestions.map(({ id, type: mediaType, title, slug: mediaSlug, year, episodeInfo }) => ({
        id, type: mediaType, title, slug: mediaSlug, year, ...(episodeInfo ? { episodeInfo } : {}),
      })));
    }

    const conditions: SQL[] = [];
    if (type) conditions.push(eq(media.type, type));
    if (category) conditions.push(eq(categories.slug, category));
    if (slug) conditions.push(eq(media.slug, slug));
    if (q) {
      const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(suggestionsOnly
        ? ilike(media.title, search)
        : or(ilike(media.title, search), ilike(media.description, search))!);
    }
    const query = db.select({
      id: media.id, type: media.type, title: media.title, slug: media.slug,
      description: media.description, posterUrl: media.posterUrl, thumbnailUrl: media.thumbnailUrl,
      year: media.year, categoryId: media.categoryId, categoryName: categories.name,
      createdAt: media.createdAt, updatedAt: media.updatedAt,
    }).from(media).leftJoin(categories, eq(media.categoryId, categories.id))
      .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(media.createdAt), desc(media.id));
    const results = suggestionsOnly ? await query.limit(8) : await query;
    if (slug) {
      if (!results[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(await getMediaDetails(results[0].id));
    }
    return NextResponse.json(results);
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const type = mediaType(body.type);
    const title = text(body.title, "Title", 255, true)!;
    const categoryId = optionalId(body.categoryId, "categoryId");
    if (categoryId !== null) {
      const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
      if (!category) return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    const [newItem] = await db.insert(media).values({
      type, title, slug: await uniqueSlug(title),
      description: text(body.description, "Description", 20000),
      posterUrl: imageUrl(body.posterUrl, "Poster URL"),
      thumbnailUrl: imageUrl(body.thumbnailUrl, "Thumbnail URL"),
      year: year(body.year), categoryId,
    }).returning();
    return NextResponse.json(newItem, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
