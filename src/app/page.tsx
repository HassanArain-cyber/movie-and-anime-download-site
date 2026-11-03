import Link from "next/link";
import MediaGrid from "@/components/MediaGrid";
import CategoryFilter from "@/components/CategoryFilter";
import { db } from "@/db";
import { media, categories } from "@/db/schema";
import { eq, and, asc, desc, isNotNull, sql } from "drizzle-orm";
import { searchMedia } from "@/lib/media-search";
import { isLibrarySort, type LibrarySort } from "@/lib/library-filters";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    category?: string;
    year?: string;
    sort?: string;
  }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const typeFilter = sp.type && ["movie", "anime", "series"].includes(sp.type) ? sp.type : undefined;
  const categorySlug = sp.category;
  const explicitSort: LibrarySort | undefined = isLibrarySort(sp.sort) ? sp.sort : undefined;
  const sortOption: LibrarySort = explicitSort ?? "newest";

  // Filters are driven by values actually present in the library.
  const [cats, yearRows] = await Promise.all([
    db.select().from(categories).orderBy(categories.name),
    db.select({ year: media.year }).from(media).where(isNotNull(media.year)).groupBy(media.year).orderBy(desc(media.year)),
  ]);
  const years = yearRows.flatMap((row) => row.year === null ? [] : [row.year]);
  const requestedYear = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : undefined;
  const yearFilter = requestedYear && years.includes(requestedYear) ? requestedYear : undefined;

  // Build conditions for the unfiltered / category browse view. Search uses the
  // same ranked title/alias/episode matcher as the live suggestion endpoint.
  const conditions: any[] = [];
  if (typeFilter) conditions.push(eq(media.type, typeFilter));
  const resolvedCategory = categorySlug ? cats.find((category) => category.slug === categorySlug) : undefined;
  if (resolvedCategory) conditions.push(eq(media.categoryId, resolvedCategory.id));
  if (yearFilter) conditions.push(eq(media.year, yearFilter));

  let items: any[] = [];
  if (q) {
    items = await searchMedia(q, {
      type: typeFilter,
      categorySlug: resolvedCategory?.slug,
      year: yearFilter,
      sort: explicitSort,
      limit: 120,
      includeDescriptions: true,
    });
  } else {
    items = await db
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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        sortOption === "az" ? asc(sql`lower(${media.title})`)
          : sortOption === "za" ? desc(sql`lower(${media.title})`)
            : sortOption === "oldest" ? asc(media.createdAt) : desc(media.createdAt),
        ...(sortOption === "az" || sortOption === "za"
          ? [desc(media.createdAt), desc(media.id)]
          : [sortOption === "oldest" ? asc(media.id) : desc(media.id)]),
      )
      .limit(120);
  }

  // Get counts per type for the hero stats
  const counts = {
    movies: items.filter((i) => i.type === "movie").length,
    anime: items.filter((i) => i.type === "anime").length,
    series: items.filter((i) => i.type === "series").length,
  };

  const hasBrowseFilters = Boolean(q || typeFilter || categorySlug || yearFilter || explicitSort);

  // Compute total counts across all media (when no filter applied)
  let totalMovies = 0, totalAnime = 0, totalSeries = 0;
  if (!hasBrowseFilters) {
    totalMovies = counts.movies;
    totalAnime = counts.anime;
    totalSeries = counts.series;
  } else {
    const totals = await db
      .select({ type: media.type, count: sql`count(*)` })
      .from(media)
      .groupBy(media.type);
    for (const t of totals) {
      if (t.type === "movie") totalMovies = Number(t.count);
      if (t.type === "anime") totalAnime = Number(t.count);
      if (t.type === "series") totalSeries = Number(t.count);
    }
  }

  const typeLabels = [
    { key: undefined, label: "All" },
    { key: "movie", label: "Movies" },
    { key: "anime", label: "Anime" },
    { key: "series", label: "Series" },
  ];

  return (
    <div className="space-y-8">
      {!hasBrowseFilters ? (
        <section className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-900 to-black p-8 sm:p-12">
          <div className="relative z-10 max-w-2xl">
            <span className="inline-block rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
              Private Library
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Your movies, anime & series. One click away.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400 sm:mt-2 sm:text-[15px]">
              Browse the collection and download instantly. No ads, no redirects, no clutter.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-neutral-500 sm:text-xs">
              <Link
                href="/?type=movie"
                className="rounded-md border border-neutral-800 px-3 py-1.5 hover:border-neutral-700 hover:text-white"
              >
                {totalMovies} movies
              </Link>
              <Link
                href="/?type=anime"
                className="rounded-md border border-neutral-800 px-3 py-1.5 hover:border-neutral-700 hover:text-white"
              >
                {totalAnime} anime
              </Link>
              <Link
                href="/?type=series"
                className="rounded-md border border-neutral-800 px-3 py-1.5 hover:border-neutral-700 hover:text-white"
              >
                {totalSeries} series
              </Link>
            </div>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-red-600/10 blur-3xl"
          />
        </section>
      ) : (
        <section>
          <h1 className="text-2xl font-bold text-white">
            {q ? (
              <>Search results for <span className="text-red-400">&ldquo;{q}&rdquo;</span></>
            ) : typeFilter ? (
              typeFilter === "movie" ? "Movies" : typeFilter === "anime" ? "Anime" : "TV Series"
            ) : categorySlug ? (
              <>Category: <span className="text-red-400">{cats.find(c => c.slug === categorySlug)?.name}</span></>
            ) : (
              "Browse"
            )}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {items.length} {items.length === 1 ? "item" : "items"} found
          </p>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {typeLabels.map((t) => {
          const active = t.key === typeFilter;
          return (
            <Link
              key={t.label}
              href={{
                pathname: "/",
                query: {
                  ...(q ? { q } : {}),
                  ...(categorySlug ? { category: categorySlug } : {}),
                  ...(yearFilter ? { year: String(yearFilter) } : {}),
                  ...(explicitSort ? { sort: explicitSort } : {}),
                  ...(t.key ? { type: t.key } : {}),
                },
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 ${
                active
                  ? "bg-white text-black ring-white"
                  : "bg-neutral-900 text-neutral-300 ring-neutral-800 hover:bg-neutral-800 hover:text-white"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        <div className="mx-2 h-6 w-px bg-neutral-800" />
        <CategoryFilter
          categories={cats}
          years={years}
          activeSlug={categorySlug}
          activeYear={yearFilter}
          activeSort={sortOption}
          baseQuery={{ q, type: typeFilter, year: yearFilter, sort: explicitSort }}
        />
      </div>

      <MediaGrid items={items} />
      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-12 text-center">
          <p className="text-neutral-500">No items found.</p>
          <p className="mt-1 text-sm text-neutral-600">
            Add content from the <Link href="/admin" className="text-red-400 hover:underline">admin panel</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
