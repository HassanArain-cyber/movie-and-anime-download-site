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

type Overrides = { category?: string; year?: number; sort?: LibrarySort };

export default function CategoryFilter({ categories, years, activeSlug, activeYear, activeSort, baseQuery }: Props) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const buildHref = (overrides: Overrides) => {
    const params = new URLSearchParams();
    if (baseQuery.q) params.set("q", baseQuery.q);
    if (baseQuery.type) params.set("type", baseQuery.type);
    const year = Object.hasOwn(overrides, "year") ? overrides.year : activeYear;
    const sort = Object.hasOwn(overrides, "sort") ? overrides.sort! : activeSort;
    const category = Object.hasOwn(overrides, "category") ? overrides.category : activeSlug;
    if (year) params.set("year", String(year));
    if (sort !== "newest") params.set("sort", sort);
    if (category) params.set("category", category);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const selectClass = "min-w-0 w-full appearance-none rounded-md border border-neutral-800 bg-neutral-900 py-1.5 pl-3 pr-8 text-sm text-neutral-200 outline-none transition hover:bg-neutral-800 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-700 sm:w-auto";

  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto" aria-label="Library filters">
      <label className="relative min-w-0 sm:min-w-36">
        <span className="sr-only">Filter by tag</span>
        <select
          aria-label="Filter by tag"
          value={activeSlug ?? ""}
          onChange={(event) => router.push(buildHref({ category: event.target.value || undefined }))}
          className={selectClass}
        >
          <option value="">All Tags</option>
          {categories.map((category) => (
            <option key={category.id} value={category.slug}>{category.name}</option>
          ))}
        </select>
        <Chevron />
      </label>
      <label className="relative min-w-0 sm:min-w-32">
        <span className="sr-only">Filter by release year</span>
        <select
          aria-label="Filter by release year"
          value={activeYear ?? ""}
          onChange={(event) => router.push(buildHref({ year: event.target.value ? Number(event.target.value) : undefined }))}
          className={selectClass}
        >
          <option value="">All Years</option>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <Chevron />
      </label>
      <label className="relative col-span-2 min-w-0 sm:col-span-1 sm:min-w-44">
        <span className="sr-only">Sort library</span>
        <select
          aria-label="Sort library"
          value={activeSort}
          onChange={(event) => router.push(buildHref({ sort: event.target.value as LibrarySort }))}
          className={selectClass}
        >
          <option value="az">A–Z</option>
          <option value="za">Z–A</option>
          <option value="newest">Newest to Oldest</option>
          <option value="oldest">Oldest to Newest</option>
        </select>
        <Chevron />
      </label>
    </div>
  );
}

function Chevron() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
    </svg>
  );
}
