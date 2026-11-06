"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

const BRAND_ICONS = [
  { id: "vault", label: "Vault" },
  { id: "film", label: "Film" },
  { id: "clapperboard", label: "Clapperboard" },
  { id: "sparkles", label: "Sparkles" },
] as const;
type BrandIconId = (typeof BRAND_ICONS)[number]["id"];
const BRAND_ICON_STORAGE_KEY = "vault-brand-icon";

function BrandIconMark({ icon, className = "h-5 w-5" }: { icon: BrandIconId; className?: string }) {
  if (icon === "film") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth="1.7" />
        <path d="M8 3v18M16 3v18M4 8h4m-4 8h4m8-8h4m-4 8h4" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "clapperboard") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M4 9h16v11H4zM4 9l1.1-5h15.1L19 9M8 4l4 5m2-5 4 5" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "sparkles") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none">
      <path d="M2 4h6l5 12-3 6L2 4Zm13 0h7l-3 6h-7l3-6Z" fill="currentColor" />
    </svg>
  );
}

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [nearTop, setNearTop] = useState(true);
  const [brandIcon, setBrandIcon] = useState<BrandIconId>("vault");
  const [brandIconPickerOpen, setBrandIconPickerOpen] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);
  const brandIconPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    try {
      const savedIcon = window.localStorage.getItem(BRAND_ICON_STORAGE_KEY);
      if (BRAND_ICONS.some(({ id }) => id === savedIcon)) {
        timer = window.setTimeout(() => setBrandIcon(savedIcon as BrandIconId), 0);
      }
    } catch {
      // The default icon remains available when browser storage is disabled.
    }
    return () => { if (timer) window.clearTimeout(timer); };
  }, []);

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

  const selectBrandIcon = (icon: BrandIconId) => {
    setBrandIcon(icon);
    setBrandIconPickerOpen(false);
    try {
      window.localStorage.setItem(BRAND_ICON_STORAGE_KEY, icon);
    } catch {
      // Keep the choice for this session even when persistent storage is unavailable.
    }
  };

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!searchRef.current?.contains(event.target)) setSearchOpen(false);
      if (!brandIconPickerRef.current?.contains(event.target)) setBrandIconPickerOpen(false);
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
      <div className="vault-nav mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 lg:flex-nowrap sm:px-6">
        <div
          ref={brandIconPickerRef}
          onKeyDown={(event) => { if (event.key === "Escape") setBrandIconPickerOpen(false); }}
          className="relative flex shrink-0 items-center gap-2"
        >
          <button
            type="button"
            aria-label="Scroll to top"
            data-testid="brand-scroll-top"
            data-brand-icon={brandIcon}
            title="Scroll to top"
            onClick={() => scrollPage(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-pink-600 text-white shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <BrandIconMark icon={brandIcon} />
          </button>
          <button
            type="button"
            aria-label="Choose brand icon"
            title="Choose brand icon"
            aria-expanded={brandIconPickerOpen}
            aria-controls="brand-icon-picker"
            onClick={() => setBrandIconPickerOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900/80 text-neutral-400 transition hover:border-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 7h10M18 7h2M4 17h2m4 0h10M14 5v4M8 15v4" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {brandIconPickerOpen && (
            <div
              id="brand-icon-picker"
              data-testid="brand-icon-picker"
              role="group"
              aria-label="Brand icon choices"
              className="absolute left-0 top-full z-[60] mt-2 w-48 rounded-xl border border-neutral-800 bg-neutral-950 p-2 shadow-2xl shadow-black/50"
            >
              <p className="px-2 pb-2 pt-1 text-xs font-medium text-neutral-400">Choose an icon</p>
              <div className="grid grid-cols-2 gap-1">
                {BRAND_ICONS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Use ${label} icon`}
                    aria-pressed={brandIcon === id}
                    onClick={() => selectBrandIcon(id)}
                    className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                      brandIcon === id
                        ? "border-purple-500/60 bg-purple-500/10 text-white"
                        : "border-transparent text-neutral-400 hover:border-neutral-800 hover:bg-neutral-900 hover:text-white"
                    }`}
                  >
                    <BrandIconMark icon={id} className="h-5 w-5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Link href="/" className="text-base font-bold tracking-tight text-white sm:text-lg">
            Gojo&apos;s Vault
          </Link>
        </div>

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

        <form ref={searchRef} onSubmit={handleSearch} role="search" className="relative order-1 ml-0 w-full max-w-none flex-none basis-full lg:order-none lg:ml-auto lg:max-w-xs lg:flex-1 lg:basis-auto">
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
                className="absolute left-1/2 top-full z-50 mt-2 w-[min(42rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/50"
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

        <RequestContact />
        <NotificationBell />

        <Link
          href="/admin"
          className="vault-signin ml-auto shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-white lg:ml-0"
        >
          Admin
        </Link>
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
