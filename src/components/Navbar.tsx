"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import RequestContact from "@/components/RequestContact";

type SearchSuggestion = {
  id: number;
  type: "movie" | "anime" | "series";
  title: string;
  slug: string;
  year: number | null;
};

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/movie", label: "Movies" },
  { href: "/anime", label: "Anime" },
  { href: "/series", label: "Series" },
];

const TYPE_LABELS: Record<SearchSuggestion["type"], string> = {
  movie: "Movie",
  anime: "Anime",
  series: "Series",
};

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !searchRef.current?.contains(event.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/media?suggestions=1&q=${encodeURIComponent(q)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const data: unknown = await response.json();
          if (!response.ok) {
            const message = typeof data === "object" && data !== null && "error" in data
              ? String(data.error)
              : "Search suggestions could not be loaded.";
            throw new Error(message);
          }
          if (!Array.isArray(data)) throw new Error("Search suggestions could not be loaded.");
          return data as SearchSuggestion[];
        })
        .then((results) => {
          if (!controller.signal.aborted) setSuggestions(results);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setSearchError(reason instanceof Error ? reason.message : "Search suggestions could not be loaded.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    setSearchOpen(false);
    if (q) router.push(`/?q=${encodeURIComponent(q)}`);
    else router.push("/");
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSuggestions([]);
    setSearchError("");
    const hasQuery = Boolean(value.trim());
    setSearchOpen(hasQuery);
    setSearchLoading(hasQuery);
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md ${
        scrolled
          ? "border-neutral-800 bg-black/80"
          : "border-transparent bg-black/40"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-red-500 to-pink-600 font-bold text-white">
            V
          </div>
          <span className="hidden text-lg font-bold tracking-tight text-white sm:inline">
            Vault
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <form ref={searchRef} onSubmit={handleSearch} role="search" className="ml-auto w-full max-w-xs flex-1">
          <div className="relative">
            <input
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onFocus={() => { if (query.trim()) setSearchOpen(true); }}
              onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }}
              autoComplete="off"
              aria-label="Search movies, anime, and series"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen && Boolean(query.trim())}
              aria-controls="search-suggestions"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 pl-8 text-sm text-white placeholder-neutral-500 outline-none focus:border-neutral-700 focus:ring-1 focus:ring-neutral-700"
            />
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchOpen && query.trim() && (
              <div
                id="search-suggestions"
                className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl shadow-black/40"
              >
                {searchLoading ? (
                  <p role="status" className="px-3 py-3 text-sm text-neutral-400">Searching titles…</p>
                ) : searchError ? (
                  <p role="status" className="px-3 py-3 text-sm text-amber-300">{searchError}</p>
                ) : suggestions.length ? (
                  <ul aria-label="Matching titles" className="max-h-80 overflow-y-auto py-1">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.id}>
                        <Link
                          href={`/${suggestion.type}/${suggestion.slug}`}
                          onClick={() => setSearchOpen(false)}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-neutral-200 transition hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
                        >
                          <span className="min-w-0 truncate font-medium">{suggestion.title}</span>
                          <span className="shrink-0 text-xs text-neutral-500">
                            {TYPE_LABELS[suggestion.type]}{suggestion.year ? ` · ${suggestion.year}` : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p role="status" className="px-3 py-3 text-sm text-neutral-400">
                    No matching titles found for “{query.trim()}”.
                  </p>
                )}
              </div>
            )}
          </div>
        </form>

        <RequestContact />

        <Link
          href="/admin"
          className="shrink-0 rounded-md border border-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-400 hover:border-neutral-700 hover:text-white"
        >
          Admin
        </Link>
      </div>

      {/* Mobile nav */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-neutral-900 px-4 py-2 md:hidden">
        {NAV_LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`shrink-0 rounded-md px-3 py-1 text-sm ${
                active
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
