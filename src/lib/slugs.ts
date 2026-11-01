import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { slugify } from "./utils";

export async function uniqueSlug(title: string, excludeId?: number): Promise<string> {
  const base = slugify(title) || "media";
  let slug = base;
  let n = 1;
  while (true) {
    const [existing] = await db.select({ id: media.id }).from(media)
      .where(and(eq(media.slug, slug), excludeId ? ne(media.id, excludeId) : undefined)).limit(1);
    if (!existing) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}
