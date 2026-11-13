import { activeContent, animeMovieFlag } from "@/lib/content-state";
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
  const conditions: any[] = [await activeContent("media", media.id)];
  if (typeFilter === "movie") conditions.push(sql`NOT (${await animeMovieFlag(media.id)})`);
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

  const hasBrowseFilters = Boolean(q || typeFilter || categorySlug || yearFilter || explicitSort);
  // Counts must include the full library, not only the first page of posters.
  const totals = await db.select({ type: media.type, count: sql`count(*)` }).from(media).where(await activeContent("media", media.id)).groupBy(media.type);
  const totalFor = (type: string) => Number(totals.find((row) => row.type === type)?.count ?? 0);
  const totalMovies = totalFor("movie"), totalAnime = totalFor("anime"), totalSeries = totalFor("series");

  return (
    <div className="space-y-8">
      {!hasBrowseFilters ? (
        <details className="group -mx-4 sm:mx-0">
          <summary className="flex h-5 w-4 cursor-pointer list-none items-center justify-center border-0 bg-transparent p-0 text-xs font-semibold text-purple-200 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">&gt;</span>
            <span className="sr-only">Show or hide Vault introduction</span>
          </summary>
          <section className="vault-hero mx-4 mt-3 sm:mx-0">
          <div className="relative z-10 max-w-3xl">
            <span className="vault-badge"><span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" /> Your next obsession awaits</span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.12] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Your movies, anime &amp; series.<br className="hidden sm:block" /> <span className="vault-gradient-text">One click away.</span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-neutral-300 sm:text-base">
              Explore Gojo&apos;s Vault. Discover a new favorite, revisit a classic, and download without the clutter.
            </p>
            <div className="vault-hero-actions mt-7 flex flex-wrap gap-3">
              <Link href="#library" className="vault-primary">Explore the vault <span aria-hidden="true">↗</span></Link>
              <Link href="/anime" className="vault-secondary">Discover anime <span aria-hidden="true">→</span></Link>
            </div>
            <div className="vault-hero-stats mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-400">
              <Link href="/?type=movie" className="hover:text-purple-300"><strong className="text-neutral-200">{totalMovies}</strong> movies</Link>
              <Link href="/?type=anime" className="hover:text-purple-300"><strong className="text-neutral-200">{totalAnime}</strong> anime</Link>
              <Link href="/?type=series" className="hover:text-purple-300"><strong className="text-neutral-200">{totalSeries}</strong> series</Link>
            </div>
          </div>
          </section>
        </details>
      ) : (
        <section>
          <h1 className="text-2xl font-bold text-white">
            {q ? (
              <>Search results for <span className="text-purple-400">&ldquo;{q}&rdquo;</span></>
            ) : typeFilter ? (
              typeFilter === "movie" ? "Movies" : typeFilter === "anime" ? "Anime" : "TV Series"
            ) : categorySlug ? (
              <>Category: <span className="text-purple-400">{cats.find(c => c.slug === categorySlug)?.name}</span></>
            ) : (
              "Browse"
            )}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {items.length} {items.length === 1 ? "item" : "items"} found
          </p>
        </section>
      )}

      <section id="library" className="scroll-mt-52 space-y-5" aria-label="Browse the library">
        <div className="flex items-end justify-between gap-3">
          <div><p className="vault-eyebrow">THE COLLECTION</p><h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">Find your next favorite</h2></div>
          <span className="shrink-0 text-xs text-neutral-400">{items.length} titles</span>
        </div>
        <CategoryFilter categories={cats} years={years} activeSlug={resolvedCategory?.slug} activeYear={yearFilter} activeSort={sortOption} baseQuery={{ q, type: typeFilter, year: yearFilter, sort: explicitSort }} />
      </section>

      <MediaGrid items={items} />
      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-12 text-center">
          <p className="text-neutral-500">No items found.</p>
          <p className="mt-1 text-sm text-neutral-600">
            Try another search or <Link href="/" className="text-purple-300 hover:underline">clear your filters</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
