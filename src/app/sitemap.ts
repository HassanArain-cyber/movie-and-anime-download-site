import type { MetadataRoute } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { activeContent } from "@/lib/content-state";

export const dynamic = "force-dynamic";
const BASE = "https://movie-and-anime-download-site.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const fixed: MetadataRoute.Sitemap = [
    { url: BASE + "/", lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: BASE + "/movies", changeFrequency: "weekly", priority: 0.7 },
    { url: BASE + "/anime", changeFrequency: "weekly", priority: 0.7 },
    { url: BASE + "/series", changeFrequency: "weekly", priority: 0.7 },
  ];
  const entries = await db.select({
    type: media.type, slug: media.slug, updatedAt: media.updatedAt, createdAt: media.createdAt,
  }).from(media).where(and(
    inArray(media.type, ["movie", "anime", "series"]),
    await activeContent("media", media.id),
  ));
  return [...fixed, ...entries.map((item) => ({
    url: BASE + "/" + item.type + "/" + encodeURIComponent(item.slug),
    lastModified: item.updatedAt ?? item.createdAt ?? undefined,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }))];
}
