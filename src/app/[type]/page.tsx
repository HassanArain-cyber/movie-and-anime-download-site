import { activeContent, animeMovieFlag } from "@/lib/content-state";
import { notFound } from "next/navigation";
import Link from "next/link";
import MediaGrid from "@/components/MediaGrid";
import CategoryFilter from "@/components/CategoryFilter";
import { db } from "@/db";
import { media, categories } from "@/db/schema";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { MediaType } from "@/lib/types";
import { isLibrarySort, type LibrarySort } from "@/lib/library-filters";

export const dynamic = "force-dynamic";

const VALID_TYPES: Record<string, { label: string }> = {
  movie: { label: "Movies" },
  anime: { label: "Anime" },
  series: { label: "TV Series" },
};

interface PageProps {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ category?: string; year?: string; sort?: string; format?: string }>;
}

export async function generateStaticParams() {
  return Object.keys(VALID_TYPES).map((type) => ({ type }));
}

export default async function TypePage({ params, searchParams }: PageProps) {
  const [{ type }, query] = await Promise.all([params, searchParams]);
  if (!VALID_TYPES[type]) notFound();
  const animeMovie = type === "anime" && query.format === "movie";
  const catalogType = animeMovie ? "movie" : type;
  const activeSort: LibrarySort = isLibrarySort(query.sort) ? query.sort : "newest";

  const [cats, yearRows] = await Promise.all([
    db.select().from(categories).orderBy(categories.name),
    db.select({ year: media.year }).from(media).where(isNotNull(media.year)).groupBy(media.year).orderBy(desc(media.year)),
  ]);
  const years = yearRows.flatMap((row) => row.year === null ? [] : [row.year]);
  const rawYear = query.year && /^\d{4}$/.test(query.year) ? Number(query.year) : undefined;
  const activeYear = rawYear && years.includes(rawYear) ? rawYear : undefined;
  const activeCategory = cats.find((category) => category.slug === query.category);
  const conditions = [eq(media.type, catalogType as MediaType), await activeContent("media", media.id)];
  if (catalogType === "movie") conditions.push(animeMovie ? await animeMovieFlag(media.id) : sql`NOT (${await animeMovieFlag(media.id)})`);
  if (activeCategory) conditions.push(eq(media.categoryId, activeCategory.id));
  if (activeYear) conditions.push(eq(media.year, activeYear));

  const items = await db
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
    })
    .from(media)
    .leftJoin(categories, eq(media.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(
      activeSort === "az" ? asc(sql`lower(${media.title})`)
        : activeSort === "za" ? desc(sql`lower(${media.title})`)
          : activeSort === "oldest" ? asc(media.createdAt) : desc(media.createdAt),
      ...(activeSort === "az" || activeSort === "za"
        ? [desc(media.createdAt), desc(media.id)]
        : [activeSort === "oldest" ? asc(media.id) : desc(media.id)]),
    );

  const label = type === "anime" ? "Anime & Movies" : VALID_TYPES[type].label;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{label}</h1>
          <p className="mt-1 text-sm text-neutral-500">{items.length} {items.length === 1 ? "title" : "titles"}</p>
        </div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-white">← Back to all</Link>
      </div>
      {type === "anime" && <nav aria-label="Anime format" className="flex gap-1"><Link aria-current={!animeMovie ? "page" : undefined} className={`min-h-9 rounded-md border px-3 py-2 text-xs ${!animeMovie ? "border-purple-500 bg-purple-500/15 text-purple-200" : "border-neutral-800 text-neutral-400"}`} href="/anime">Anime</Link><Link aria-current={animeMovie ? "page" : undefined} className={`min-h-9 rounded-md border px-3 py-2 text-xs ${animeMovie ? "border-purple-500 bg-purple-500/15 text-purple-200" : "border-neutral-800 text-neutral-400"}`} href="/anime?format=movie">Movie</Link></nav>}
      <div className="flex flex-wrap items-center gap-2">
        <CategoryFilter
          categories={cats}
          years={years}
          activeSlug={activeCategory?.slug}
          activeYear={activeYear}
          activeSort={activeSort}
          baseQuery={{ type: catalogType, ...(animeMovie ? { format: "movie" } : {}) }}
        />
      </div>
      <MediaGrid items={items as any[]} />
      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-12 text-center text-neutral-500">
          No titles match these filters.
        </div>
      )}
    </div>
  );
}
