import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, categories } from "@/db/schema";
import { eq, ilike, or, and, desc, type SQL } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { getMediaDetails } from "@/lib/library";
import { uniqueSlug } from "@/lib/slugs";
import { errorResponse, mediaType, optionalId, readJson, text, year } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category");
  const slug = searchParams.get("slug");
  try {
    const conditions: SQL[] = [];
    if (type) conditions.push(eq(media.type, type));
    if (category) conditions.push(eq(categories.slug, category));
    if (slug) conditions.push(eq(media.slug, slug));
    if (q) {
      const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(or(ilike(media.title, search), ilike(media.description, search))!);
    }
    const results = await db.select({
      id: media.id, type: media.type, title: media.title, slug: media.slug,
      description: media.description, posterUrl: media.posterUrl, thumbnailUrl: media.thumbnailUrl,
      year: media.year, categoryId: media.categoryId, categoryName: categories.name,
      createdAt: media.createdAt, updatedAt: media.updatedAt,
    }).from(media).leftJoin(categories, eq(media.categoryId, categories.id))
      .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(media.createdAt), desc(media.id));
    if (slug) {
      if (!results[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(await getMediaDetails(results[0].id));
    }
    return NextResponse.json(results);
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
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
      posterUrl: text(body.posterUrl, "Poster URL", 8192),
      thumbnailUrl: text(body.thumbnailUrl, "Thumbnail URL", 8192),
      year: year(body.year), categoryId,
    }).returning();
    return NextResponse.json(newItem, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
