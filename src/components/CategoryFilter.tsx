"use client";

import { usePathname, useRouter } from "next/navigation";
import CompactSelect from "./CompactSelect";
import type { Category } from "@/lib/types";
import type { LibrarySort } from "@/lib/library-filters";

interface Props {
  categories: Category[];
  years: number[];
  activeSlug?: string;
  activeYear?: number;
  activeSort: LibrarySort;
  baseQuery: { format?: string; q?: string; type?: string; year?: number; sort?: LibrarySort };
}

type Overrides = { type?: string; category?: string; year?: number; sort?: LibrarySort };

export default function CategoryFilter({ categories, years, activeSlug, activeYear, activeSort, baseQuery }: Props) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const buildHref = (overrides: Overrides) => {
    const params = new URLSearchParams();
    if (baseQuery.format && !Object.hasOwn(overrides, "type")) params.set("format", baseQuery.format);
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

  const filtered = Boolean(activeSlug || activeYear || activeSort !== "newest" || baseQuery.type || baseQuery.q);
  return <div className="vault-filters" aria-label="Library filters">
    <CompactSelect label="Filter by content type" value={baseQuery.type ?? ""} active={Boolean(baseQuery.type)}
      options={[{ value: "", label: "Content" }, { value: "movie", label: "Movies" }, { value: "anime", label: "Anime" }, { value: "series", label: "Series" }]}
      onChange={(type) => router.push(buildHref({ type: type || undefined }))} />
    <CompactSelect label="Filter by tag" value={activeSlug ?? ""} active={Boolean(activeSlug)}
      options={[{ value: "", label: "Tags" }, ...categories.map((category) => ({ value: category.slug, label: category.name }))]}
      onChange={(category) => router.push(buildHref({ category: category || undefined }))} />
    <CompactSelect label="Filter by release year" value={String(activeYear ?? "")} active={Boolean(activeYear)}
      options={[{ value: "", label: "Years" }, ...years.map((year) => ({ value: String(year), label: String(year) }))]}
      onChange={(year) => router.push(buildHref({ year: year ? Number(year) : undefined }))} />
    <CompactSelect label="Sort library" value={activeSort} active={activeSort !== "newest"}
      options={[{ value: "az", label: "A–Z" }, { value: "za", label: "Z–A" }, { value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }]}
      onChange={(sort) => router.push(buildHref({ sort: sort as LibrarySort }))} />
    {filtered && <button type="button" className="vault-filter-reset px-2 text-left text-xs font-medium text-purple-300 hover:text-white" onClick={() => router.push("/")}>Reset filters ×</button>}
  </div>;
}
