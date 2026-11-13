"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import searchStyles from "./PublicSearch.module.css";
import NotificationBell from "./NotificationBell";
import RequestContact from "@/components/RequestContact";
import { isSearchableContentType } from "@/lib/search";

type SearchSuggestion = {
  id: number;
  type: "movie" | "anime" | "series";
  title: string;
  slug: string;
  year: number | null;
  resultKind: "title" | "episode";
  episodeId?: number;
  episodeInfo?: { seasonNumber: number; episodeNumber: number; title: string | null };
};

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/movie", label: "Movies" },
  { href: "/anime", label: "Anime & Movies" },
  { href: "/series", label: "Series" },
  { href: "/following", label: "Following" },
];

const TYPE_LABELS: Record<SearchSuggestion["type"], string> = {
  movie: "Movie",
  anime: "Anime",
  series: "Series",
};

function getActiveContentType(pathname: string | null): SearchSuggestion["type"] | undefined {
  const queryType = new URLSearchParams(window.location.search).get("type");
  if (isSearchableContentType(queryType)) return queryType;
  const pathType = pathname?.split("/").filter(Boolean)[0] ?? "";
  return isSearchableContentType(pathType) ? pathType : undefined;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (searchExpanded) searchInput.current?.focus({ preventScroll: true });
  }, [searchExpanded]);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => { setSearchExpanded(false); setSearchOpen(false); searchToggle.current?.focus({ preventScroll: true }); };
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [nearTop, setNearTop] = useState(true);
  const searchRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let frame = 0;
    const updateScrollState = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const scrollY = window.scrollY || document.documentElement.scrollTop;
        setScrolled(scrollY > 8);
        setNearTop(scrollY <= 80);
        frame = 0;
      });
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      window.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const scrollPage = (toBottom: boolean) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: toBottom ? document.documentElement.scrollHeight : 0,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!searchRef.current?.contains(event.target)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ suggestions: "1", q });
    const contentType = getActiveContentType(pathname);
    if (contentType) params.set("type", contentType);
    const currentParams = new URLSearchParams(window.location.search);
    const tag = currentParams.get("category");
    const year = currentParams.get("year");
    if (tag) params.set("category", tag);
    if (year && /^\d{4}$/.test(year)) params.set("year", year);
    const timer = window.setTimeout(() => {
      fetch(`/api/media?${params.toString()}`, {
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
  }, [query, pathname]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    setSearchOpen(false);
    if (q) {
      const params = new URLSearchParams({ q });
      const contentType = getActiveContentType(pathname);
      if (contentType) params.set("type", contentType);
      const currentParams = new URLSearchParams(window.location.search);
      const tag = currentParams.get("category");
      const year = currentParams.get("year");
      const sort = currentParams.get("sort");
      if (tag) params.set("category", tag);
      if (year && /^\d{4}$/.test(year)) params.set("year", year);
      if (["az", "za", "newest", "oldest"].includes(sort ?? "")) params.set("sort", sort!);
      router.push(`/?${params.toString()}`);
    } else router.push("/");
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSuggestions([]);
    setSearchError("");
    const hasQuery = Boolean(value.trim());
    setSearchOpen(hasQuery);
    setSearchLoading(value.trim().length >= 2);
  };

  return (
    <>
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md ${
        scrolled
          ? "border-neutral-800 bg-black/80"
          : "border-transparent bg-black/40"
      }`}
    >
      <div className="vault-nav mx-auto flex max-w-7xl flex-nowrap items-center gap-2 px-4 py-2 sm:px-6">
        <nav className="hidden items-center gap-1 lg:flex">
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

        <form ref={searchRef} onSubmit={handleSearch} role="search" className={`relative min-w-0 ${searchExpanded ? "flex-1" : "w-[38px] shrink-0"} lg:ml-auto lg:max-w-xs`}>
          <div className="relative">
            <div className={searchStyles.shell} data-open={searchExpanded} data-testid="public-search-shell">
              <button ref={searchToggle} type="button" aria-label="Open anime search" title="Search movies, anime, and series" aria-expanded={searchExpanded} aria-controls="public-search-field" onClick={() => searchExpanded ? closeSearch() : setSearchExpanded(true)} className={searchStyles.toggle}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
              </button>
              <div id="public-search-field" className={searchStyles.field} inert={!searchExpanded} aria-hidden={!searchExpanded}>
            <input
              ref={searchInput}
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onFocus={() => { if (query.trim()) setSearchOpen(true); }}
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }}
              autoComplete="off"
              aria-label="Search movies, anime, and series"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchOpen && Boolean(query.trim())}
              aria-controls="search-suggestions"
              className={searchStyles.input}
            />
                <button type="button" aria-label="Close anime search" title="Close search" onClick={closeSearch} className={searchStyles.close}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
              </div>
            </div>
            {searchOpen && query.trim() && (
              <div
                id="search-suggestions"
                className="absolute left-0 top-full z-50 mt-2 w-[min(42rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/50"
              >
                {searchLoading ? (
                  <p role="status" className="px-3 py-3 text-sm text-neutral-400">Searching titles…</p>
                ) : searchError ? (
                  <p role="status" className="px-3 py-3 text-sm text-amber-300">{searchError}</p>
                ) : query.trim().length < 2 ? (
                  <p role="status" className="px-3 py-3 text-sm text-neutral-400">Type at least 2 characters to search.</p>
                ) : suggestions.length ? (
                  <ul aria-label="Matching titles" className="max-h-[min(70vh,34rem)] space-y-2 overflow-y-auto p-2 sm:p-3">
                    {suggestions.map((suggestion) => {
                      const episode = suggestion.resultKind === "episode" ? suggestion.episodeInfo : undefined;
                      const episodeTitle = episode?.title || `Episode ${episode?.episodeNumber ?? ""}`;
                      const href = `/${suggestion.type}/${suggestion.slug}${episode && suggestion.episodeId !== undefined ? `#episode-${suggestion.episodeId}` : ""}`;
                      return (
                        <li key={episode ? `episode-${suggestion.episodeId}` : `title-${suggestion.id}`}>
                          <Link
                            href={href}
                            aria-label={episode
                              ? `${episodeTitle}, from ${suggestion.title}, Season ${episode.seasonNumber} Episode ${episode.episodeNumber}, ${TYPE_LABELS[suggestion.type]}`
                              : `${suggestion.title}, ${TYPE_LABELS[suggestion.type]} title`}
                            onClick={() => setSearchOpen(false)}
                            className="grid min-h-[4.5rem] grid-cols-1 gap-2 rounded-lg border border-neutral-800/80 bg-neutral-900/60 p-3 text-neutral-100 transition hover:border-neutral-700 hover:bg-neutral-900 focus:border-neutral-600 focus:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-violet-500/40 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] sm:items-center sm:gap-4 sm:p-4"
                          >
                            <span className="min-w-0 space-y-1">
                              <span className="block whitespace-normal break-words text-sm font-semibold leading-snug sm:text-base">
                                {episode ? episodeTitle : suggestion.title}
                              </span>
                              {episode && (
                                <span className="block whitespace-normal break-words text-xs leading-relaxed text-neutral-400 sm:text-sm">
                                  From <span className="font-medium text-neutral-300">{suggestion.title}</span>
                                </span>
                              )}
                            </span>
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-neutral-800 pt-2 text-xs sm:justify-end sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 sm:text-right">
                              <span className={episode ? "rounded-md bg-purple-500/10 px-2 py-1 font-medium text-purple-300" : "rounded-md bg-neutral-800 px-2 py-1 font-medium text-neutral-300"}>
                                {episode ? "Episode" : "Title"}
                              </span>
                              <span className="text-neutral-300">{TYPE_LABELS[suggestion.type]}</span>
                              {suggestion.year && <span className="text-neutral-500">{suggestion.year}</span>}
                              {episode && <span className="basis-full text-neutral-400 sm:basis-auto">Season {episode.seasonNumber} · Episode {episode.episodeNumber}</span>}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p role="status" className="px-3 py-3 text-sm text-neutral-400">
                    No matching results found for “{query.trim()}”.
                  </p>
                )}
              </div>
            )}
          </div>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <RequestContact />
          <NotificationBell />

        <Link
          href="/admin"
          aria-label="Admin"
          className="vault-signin shrink-0 rounded-lg px-2 py-2 text-xs font-semibold text-white lg:ml-0"
        >
          Ad
        </Link>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="flex items-center gap-1 overflow-x-auto border-t border-neutral-900 px-4 py-2 lg:hidden">
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
    <button
      type="button"
      aria-label={nearTop ? "Scroll to bottom" : "Scroll to top"}
      data-testid="page-scroll-toggle"
      title={nearTop ? "Scroll to bottom" : "Scroll to top"}
      onClick={() => scrollPage(nearTop)}
      className="fixed z-40 flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/95 text-neutral-100 shadow-xl backdrop-blur transition hover:border-purple-500 hover:bg-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
      style={{
        right: "calc(1rem + env(safe-area-inset-right, 0px))",
        bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {nearTop ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m0 0 7-7m-7 7-7-7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20V4m0 0-7 7m7-7 7 7" />
        )}
      </svg>
    </button>
    </>
  );
}
