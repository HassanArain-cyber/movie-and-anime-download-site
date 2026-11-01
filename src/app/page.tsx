import Link from "next/link";
import MediaGrid from "@/components/MediaGrid";
import CategoryFilter from "@/components/CategoryFilter";
import { db } from "@/db";
import { media, categories } from "@/db/schema";
import { eq, like, or, and, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface HomeProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    category?: string;
  }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const typeFilter = sp.type;
  const categorySlug = sp.category;

  // Fetch categories
  const cats = await db.select().from(categories).orderBy(categories.name);

  // Build conditions for featured / latest
  const conditions: any[] = [];
  if (q) {
    const search = `%${q}%`;
    conditions.push(
      or(like(media.title, search), like(media.description ?? "", search))
    );
  }
  if (typeFilter && ["movie", "anime", "series"].includes(typeFilter)) {
    conditions.push(eq(media.type, typeFilter));
  }
  if (categorySlug) {
    const cat = cats.find((c) => c.slug === categorySlug);
    if (cat) conditions.push(eq(media.categoryId, cat.id));
  }

  let items: any[] = [];
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
    .orderBy(desc(media.createdAt))
    .limit(120);

  // Get counts per type for the hero stats
  const counts = {
    movies: items.filter((i) => i.type === "movie").length,
    anime: items.filter((i) => i.type === "anime").length,
    series: items.filter((i) => i.type === "series").length,
  };

  // Compute total counts across all media (when no filter applied)
  let totalMovies = 0, totalAnime = 0, totalSeries = 0;
  if (!q && !typeFilter && !categorySlug) {
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
      {!q && !typeFilter && !categorySlug ? (
        <section className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900 via-neutral-900 to-black p-8 sm:p-12">
          <div className="relative z-10 max-w-2xl">
            <span className="inline-block rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
              Private Library
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Your movies, anime & series. One click away.
            </h1>
            <p className="mt-3 text-neutral-400">
              Browse the collection and download instantly. No ads, no redirects, no clutter.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs text-neutral-500">
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
          activeSlug={categorySlug}
          baseQuery={{ q, type: typeFilter }}
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
