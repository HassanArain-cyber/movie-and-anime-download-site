import { NextResponse } from "next/server";
import { db } from "@/db";
import { media, seasons, episodes, downloadLinks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

// GET single media with seasons/episodes/links
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mediaId = Number(id);
  if (!mediaId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const [item] = await db.select().from(media).where(eq(media.id, mediaId));
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Get seasons with episodes for series/anime
    let seasonList: any[] = [];
    let directLinks: any[] = [];

    if (item.type === "movie") {
      // Movie-level download links (no episode attached)
      const allLinks = await db
        .select()
        .from(downloadLinks)
        .where(eq(downloadLinks.mediaId, mediaId));
      directLinks = allLinks.filter((l) => l.episodeId === null);
    } else {
      seasonList = await db
        .select()
        .from(seasons)
        .where(eq(seasons.mediaId, mediaId))
        .orderBy(seasons.seasonNumber);

      for (const s of seasonList) {
        const eps = await db
          .select()
          .from(episodes)
          .where(eq(episodes.seasonId, s.id))
          .orderBy(episodes.episodeNumber);
        const epsWithLinks = [];
        for (const ep of eps) {
          const links = await db
            .select()
            .from(downloadLinks)
            .where(eq(downloadLinks.episodeId, ep.id));
          epsWithLinks.push({ ...ep, downloadLinks: links });
        }
        (s as any).episodes = epsWithLinks;
      }
    }

    return NextResponse.json({
      ...item,
      seasons: seasonList,
      downloadLinks: directLinks,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/media/:id - update
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  const { id } = await params;
  const mediaId = Number(id);
  if (!mediaId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const updates: Record<string, any> = {};
    const allowedFields = [
      "type",
      "title",
      "description",
      "posterUrl",
      "thumbnailUrl",
      "year",
      "categoryId",
    ];
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] =
          body[field] === "" ? null : field === "year" || field === "categoryId" ? (body[field] ? Number(body[field]) : null) : body[field];
      }
    }
    if (body.title) {
      updates.slug = slugify(body.title);
    }
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(media)
      .set(updates)
      .where(eq(media.id, mediaId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/media/:id
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  const { id } = await params;
  const mediaId = Number(id);
  if (!mediaId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await db.delete(media).where(eq(media.id, mediaId));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
