import type { MetadataRoute } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { activeContent } from "@/lib/content-state";
import { SITE_ORIGIN, mediaCanonicalUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";
const BASE = SITE_ORIGIN;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = [
    { url: BASE + "/", changeFrequency: "weekly", priority: 1 },
    { url: BASE + "/movie", changeFrequency: "weekly", priority: 0.7 },
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
    url: mediaCanonicalUrl(item as Parameters<typeof mediaCanonicalUrl>[0]),
    lastModified: item.updatedAt ?? item.createdAt ?? undefined,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }))];
}
