"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Category } from "@/lib/types";

interface Props {
  categories: Category[];
  activeSlug?: string;
  baseQuery: { q?: string; type?: string };
}

export default function CategoryFilter({
  categories,
  activeSlug,
  baseQuery,
}: Props) {
  const pathname = usePathname() || "/";

  const buildHref = (catSlug?: string) => {
    const params = new URLSearchParams();
    if (baseQuery.q) params.set("q", baseQuery.q);
    if (baseQuery.type) params.set("type", baseQuery.type);
    if (catSlug) params.set("category", catSlug);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Link
        href={buildHref()}
        className={`rounded-md px-3 py-1.5 text-sm ${
          !activeSlug
            ? "bg-neutral-800 text-white"
            : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
        }`}
      >
        All Categories
      </Link>
      {categories.map((cat) => {
        const active = cat.slug === activeSlug;
        return (
          <Link
            key={cat.id}
            href={buildHref(cat.slug)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
            }`}
          >
            {cat.name}
          </Link>
        );
      })}
    </div>
  );
}
