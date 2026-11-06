import { activeContent, animeMovieFlag, requireLifecycle } from "@/lib/content-state";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, categories, contentState } from "@/db/schema";
import { eq, ilike, or, and, desc, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getMediaDetails } from "@/lib/library";
import { uniqueSlug } from "@/lib/slugs";
import { ApiError, errorResponse, imageUrl, mediaType, optionalId, readJson, text, year } from "@/lib/validation";
import { searchMedia } from "@/lib/media-search";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category");
  const rawYear = searchParams.get("year");
  const yearFilter = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : undefined;
  const slug = searchParams.get("slug");
  const suggestionsOnly = searchParams.get("suggestions") === "1";
  try {
    if (suggestionsOnly) {
      const suggestions = q
        ? await searchMedia(q, {
          type: type ?? undefined,
          categorySlug: category ?? undefined,
          year: yearFilter,
          limit: 12,
          includeEpisodeResults: true,
        })
        : [];
      return NextResponse.json(suggestions.map(({ id, type: mediaType, title, slug: mediaSlug, year, episodeInfo, episodeId, resultKind }) => ({
        id, type: mediaType, title, slug: mediaSlug, year, resultKind,
        ...(episodeId !== undefined ? { episodeId } : {}),
        ...(episodeInfo ? { episodeInfo } : {}),
      })));
    }

    const conditions: SQL[] = [await activeContent("media", media.id)];
    if (type) conditions.push(eq(media.type, type));
    if (type === "movie") { const flag = await animeMovieFlag(media.id); conditions.push(searchParams.get("animeMovie") === "true" ? flag : sql`NOT (${flag})`); }
    if (category) conditions.push(eq(categories.slug, category));
    if (slug) conditions.push(eq(media.slug, slug));
    if (q) {
      const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(suggestionsOnly
        ? ilike(media.title, search)
        : or(ilike(media.title, search), ilike(media.description, search))!);
    }
    const query = db.select({
      isAnimeMovie: await animeMovieFlag(media.id),
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
    if ("isAnimeMovie" in body && typeof body.isAnimeMovie !== "boolean") throw new ApiError(400, "isAnimeMovie must be true or false");
    if (body.isAnimeMovie === true) { if (type !== "movie") throw new ApiError(400, "Anime movies must be standalone movies"); await requireLifecycle(); }
    const title = text(body.title, "Title", 255, true)!;
    const categoryId = optionalId(body.categoryId, "categoryId");
    if (categoryId !== null) {
      const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
      if (!category) return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    const payload = {
      type, title, slug: await uniqueSlug(title),
      description: text(body.description, "Description", 20000),
      posterUrl: imageUrl(body.posterUrl, "Poster URL"),
      thumbnailUrl: imageUrl(body.thumbnailUrl, "Thumbnail URL"),
      year: year(body.year), categoryId,
    };
    const newItem = await db.transaction(async (tx) => {
      const [created] = await tx.insert(media).values(payload).returning();
      if (body.isAnimeMovie === true) await tx.insert(contentState).values({ kind: "media", contentId: created.id, isAnimeMovie: true });
      return created;
    });
    return NextResponse.json({ ...newItem, isAnimeMovie: body.isAnimeMovie === true }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
