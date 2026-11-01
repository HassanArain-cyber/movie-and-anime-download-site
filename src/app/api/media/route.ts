import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, categories, downloadLinks } from "@/db/schema";
import { eq, like, or, and, desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

// GET /api/media - list media with optional filters
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q");
  const category = searchParams.get("category");
  const slug = searchParams.get("slug");

  try {
    let query = db
      .select({
        id: media.id,
        type: media.type,
        title: media.title,
        slug: media.slug,
        description: media.description,
        posterUrl: media.posterUrl,
        thumbnailUrl: media.thumbnailUrl,
        year: media.year,
        categoryId: media.categoryId,
        categoryName: categories.name,
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
      })
      .from(media)
      .leftJoin(categories, eq(media.categoryId, categories.id));

    const conditions = [];
    if (type) conditions.push(eq(media.type, type as string));
    if (category) conditions.push(eq(categories.slug, category as string));
    if (q) {
      const search = `%${q}%`;
      conditions.push(
        or(
          like(media.title, search),
          like(media.description ?? "", search)
        )
      );
    }
    if (slug) conditions.push(eq(media.slug, slug as string));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    query = query.orderBy(desc(media.createdAt)) as typeof query;

    const results = await query;

    if (slug) {
      const item = results[0];
      if (!item) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Also fetch direct download links (for movies)
      const links = await db
        .select()
        .from(downloadLinks)
        .where(
          and(eq(downloadLinks.mediaId, item.id), eq(downloadLinks.episodeId, sql`null`))
        );
      return NextResponse.json({ ...item, downloadLinks: links });
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/media - create new media (admin only)
export async function POST(req: Request) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  try {
    const body = await req.json();
    const { type, title, description, posterUrl, thumbnailUrl, year, categoryId } =
      body;

    if (!type || !["movie", "anime", "series"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid type. Must be movie, anime, or series." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Generate unique slug
    const baseSlug = slugify(title);
    let slug = baseSlug;
    let n = 1;
    while (true) {
      const existing = await db
        .select({ id: media.id })
        .from(media)
        .where(eq(media.slug, slug))
        .limit(1);
      if (existing.length === 0) break;
      n++;
      slug = `${baseSlug}-${n}`;
    }

    const [newItem] = await db
      .insert(media)
      .values({
        type,
        title,
        slug,
        description: description || null,
        posterUrl: posterUrl || null,
        thumbnailUrl: thumbnailUrl || null,
        year: year ? Number(year) : null,
        categoryId: categoryId ? Number(categoryId) : null,
      })
      .returning();

    return NextResponse.json(newItem, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
