"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Category } from "@/lib/types";
import type { LibrarySort } from "@/lib/library-filters";

interface Props {
  categories: Category[];
  years: number[];
  activeSlug?: string;
  activeYear?: number;
  activeSort: LibrarySort;
  baseQuery: { q?: string; type?: string; year?: number; sort?: LibrarySort };
}

type Overrides = { type?: string; category?: string; year?: number; sort?: LibrarySort };

export default function CategoryFilter({ categories, years, activeSlug, activeYear, activeSort, baseQuery }: Props) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const buildHref = (overrides: Overrides) => {
    const params = new URLSearchParams();
    if (baseQuery.q) params.set("q", baseQuery.q);
    const type = Object.hasOwn(overrides, "type") ? overrides.type : baseQuery.type;
    if (type) params.set("type", type);
    const year = Object.hasOwn(overrides, "year") ? overrides.year : activeYear;
    const sort = Object.hasOwn(overrides, "sort") ? overrides.sort! : activeSort;
    const category = Object.hasOwn(overrides, "category") ? overrides.category : activeSlug;
    if (year) params.set("year", String(year));
    if (sort !== "newest") params.set("sort", sort);
    if (category) params.set("category", category);
    const qs = params.toString();
    const target = Object.hasOwn(overrides, "type") ? "/" : pathname;
    return qs ? `${target}?${qs}` : target;
  };

  const selectClass = "vault-select";
  const filtered = Boolean(activeSlug || activeYear || activeSort !== "newest" || baseQuery.type || baseQuery.q);

  return (
    <div className="vault-filters" aria-label="Library filters">
      <label className="relative min-w-0">
        <span className="sr-only">Filter by content type</span>
        <select aria-label="Filter by content type" className={selectClass} value={baseQuery.type ?? ""} data-active={Boolean(baseQuery.type)} onChange={(event) => router.push(buildHref({ type: event.target.value || undefined }))}>
          <option value="">Content</option><option value="movie">Movies</option><option value="anime">Anime</option><option value="series">Series</option>
        </select><Chevron />
      </label>
      <label className="relative min-w-0">
        <span className="sr-only">Filter by tag</span>
        <select
          aria-label="Filter by tag"
          data-active={Boolean(activeSlug)}
          value={activeSlug ?? ""}
          onChange={(event) => router.push(buildHref({ category: event.target.value || undefined }))}
          className={selectClass}
        >
          <option value="">Tags</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>{category.name}</option>
          ))}
        </select>
        <Chevron />
      </label>
      <label className="relative min-w-0">
        <span className="sr-only">Filter by release year</span>
        <select
          aria-label="Filter by release year"
          data-active={Boolean(activeYear)}
          value={activeYear ?? ""}
          onChange={(event) => router.push(buildHref({ year: event.target.value ? Number(event.target.value) : undefined }))}
          className={selectClass}
        >
          <option value="">Years</option>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <Chevron />
      </label>
      <label className="relative min-w-0">
        <span className="sr-only">Sort library</span>
        <select
          aria-label="Sort library"
          data-active={activeSort !== "newest"}
          value={activeSort}
          onChange={(event) => router.push(buildHref({ sort: event.target.value as LibrarySort }))}
          className={selectClass}
        >
          <option value="az">A–Z</option>
          <option value="za">Z–A</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
        <Chevron />
      </label>
      {filtered && <button type="button" className="vault-filter-reset px-2 text-left text-xs font-medium text-purple-300 hover:text-white" onClick={() => router.push("/")}>Reset filters ×</button>}
    </div>
  );
}

function Chevron() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
    </svg>
  );
}
