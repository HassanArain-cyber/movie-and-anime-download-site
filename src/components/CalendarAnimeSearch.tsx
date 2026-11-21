"use client";

import { useEffect, useState } from "react";
import PosterImage from "@/components/PosterImage";
import { useUpdates } from "@/components/UpdatesProvider";
import { useCalendarFollows } from "@/components/useCalendarFollows";
import { updateCalendarFollow } from "@/lib/calendar-follows";

type AnimeResult = {
  id: number;
  title: string;
  posterUrl: string | null;
  totalEpisodes: number | null;
  nextAiring: { episode: number; airingAt: string } | null;
};

function airingLabel(item: AnimeResult) {
  if (!item.nextAiring) return "No confirmed next airing";
  return "Ep " + item.nextAiring.episode + " · " + new Date(item.nextAiring.airingAt).toLocaleString("en-PK", {
    timeZone: "Asia/Karachi", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " PKT";
}

export default function CalendarAnimeSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AnimeResult[]>([]);
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [followError, setFollowError] = useState("");
  const [followBusy, setFollowBusy] = useState<number | null>(null);
  const follows = useCalendarFollows();
  const { data: vaultData, follow: followVault } = useUpdates();

  useEffect(() => {
    const title = query.trim();
    if (title.length < 2 || title.length > 80) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/calendar-search?q=" + encodeURIComponent(title), {
        signal: controller.signal, cache: "no-store",
      }).then(async (response) => {
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.results)) {
          throw new Error(typeof body.error === "string" ? body.error : "Could not search anime");
        }
        return body.results as AnimeResult[];
      }).then((items) => {
        if (controller.signal.aborted) return;
        setResults(items); setSearched(title); setLoading(false);
      }).catch((reason) => {
        if (controller.signal.aborted) return;
        setResults([]); setSearched(title); setLoading(false);
        setSearchError(reason instanceof Error ? reason.message : "Could not search anime");
      });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const updateSearch = (value: string) => {
    setQuery(value);
    setResults([]);
    setSearched("");
    setSearchError("");
    setFollowError("");
    setLoading(value.trim().length >= 2 && value.trim().length <= 80);
  };

  const toggleFollow = async (item: AnimeResult) => {
    if (followBusy !== null) return;
    const local = follows.find((entry) => entry.source === "anilist" && entry.externalId === item.id);
    const vault = vaultData?.following.find((entry) =>
      entry.externalSource === "anilist" && entry.externalId === String(item.id));
    setFollowBusy(item.id); setFollowError("");
    try {
      if (vault) await followVault(vault.id, false);
      if (local) updateCalendarFollow(local, false);
      if (!local && !vault) updateCalendarFollow({
        source: "anilist", externalId: item.id, title: item.title,
        posterUrl: item.posterUrl, addedAt: Date.now(),
      }, true);
    } catch (reason) {
      setFollowError(reason instanceof Error ? reason.message : "Could not update Following.");
    } finally { setFollowBusy(null); }
  };

  return (
    <section aria-label="Search anime to follow" className="rounded-2xl border border-violet-500/25 bg-gradient-to-r from-[#16112a] via-[#10172b] to-[#071a31] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white sm:text-base">Find anime to follow</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Search any anime, even if it is not on Vault or this month's calendar.</p>
        </div>
        <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200">No account needed</span>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-300">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
          </svg>
          <input type="search" aria-label="Search any anime to follow" value={query} onChange={(event) => updateSearch(event.target.value)}
            placeholder="Search anime title…" maxLength={80}
            className="min-h-11 w-full min-w-0 rounded-xl border border-violet-400/25 bg-[#0a0c18]/90 py-2.5 pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20" />
        </div>
      </div>
      {query.trim().length === 1 && <p className="mt-2 text-xs text-slate-400">Type at least 2 characters to search.</p>}
      {loading && <p role="status" className="mt-3 text-xs text-violet-200">Searching anime…</p>}
      {searchError && <p role="alert" className="mt-3 text-xs text-rose-300">{searchError}</p>}
      {followError && <p role="alert" className="mt-3 text-xs text-rose-300">{followError}</p>}
      {!loading && searched === query.trim() && query.trim().length >= 2 && !searchError && !results.length &&
        <p className="mt-3 text-xs text-slate-400">No matching anime found. Try another title or spelling.</p>}
      {!loading && searched === query.trim() && !!results.length && (
        <div aria-label="Anime search results" className="mt-3 max-h-80 space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
          {results.map((item) => {
            const local = follows.some((entry) => entry.source === "anilist" && entry.externalId === item.id);
            const vault = vaultData?.following.some((entry) =>
              entry.externalSource === "anilist" && entry.externalId === String(item.id));
            const followed = local || !!vault;
            return (
              <article key={item.id} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-black/20 p-2">
                <a href={"https://anilist.co/anime/" + item.id} target="_blank" rel="noopener noreferrer"
                  aria-label={"View " + item.title + " on AniList"} className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                  <PosterImage src={item.posterUrl} title={item.title} sizes="48px" className="object-cover" />
                </a>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs font-bold leading-snug text-white">{item.title}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{item.totalEpisodes ? item.totalEpisodes + " episodes" : "Episode count not announced"}</p>
                  <p className="mt-0.5 text-[10px] text-emerald-300">{airingLabel(item)}</p>
                </div>
                <button type="button" aria-label={(followed ? "Unfollow " : "Follow ") + item.title}
                  aria-pressed={followed} aria-busy={followBusy === item.id} disabled={followBusy !== null}
                  onClick={() => void toggleFollow(item)}
                  className={"min-h-10 shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-bold transition disabled:opacity-50 " +
                    (followed ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200" : "border-violet-400/35 bg-violet-600/25 text-violet-100 hover:bg-violet-600/40")}>
                  {followBusy === item.id ? "Saving…" : followed ? "✓ Following" : "+ Follow"}
                </button>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-500">Calendar-only follows are saved on this device. A scheduled episode is not necessarily uploaded to Vault.</p>
    </section>
  );
}
