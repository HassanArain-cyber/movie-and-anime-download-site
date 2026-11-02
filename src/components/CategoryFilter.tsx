"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Category } from "@/lib/types";

interface Props {
  categories: Category[];
  activeSlug?: string;
  baseQuery: { q?: string; type?: string };
}

export default function CategoryFilter({ categories, activeSlug, baseQuery }: Props) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const buildHref = (catSlug?: string) => {
    const params = new URLSearchParams();
    if (baseQuery.q) params.set("q", baseQuery.q);
    if (baseQuery.type) params.set("type", baseQuery.type);
    if (catSlug) params.set("category", catSlug);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Filter by tag</span>
      <select
        aria-label="Filter by tag"
        value={activeSlug ?? ""}
        onChange={(event) => router.push(buildHref(event.target.value || undefined))}
        className="min-w-36 appearance-none rounded-md border border-neutral-800 bg-neutral-900 py-1.5 pl-3 pr-9 text-sm text-neutral-200 outline-none transition hover:bg-neutral-800 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-700"
      >
        <option value="">All Tags</option>
        {categories.map((category) => (
          <option key={category.id} value={category.slug}>
            {category.name}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-neutral-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
