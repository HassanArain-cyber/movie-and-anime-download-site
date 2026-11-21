"use client";

import { useRef, useState } from "react";
import PosterImage from "@/components/PosterImage";
import type { MediaType } from "@/lib/types";

export type ImportChoice = {
  title: string;
  description: string;
  posterUrl: string | null;
  year: number | null;
  genres: string;
  episodeCount: number | null;
  externalSource: "anilist" | "tvmaze" | "tmdb";
  externalId: string;
};
type Props = { type: MediaType; initialQuery: string; onSelect: (item: ImportChoice) => void; disabled?: boolean };
const providerLabel: Record<MediaType, string> = { anime: "AniList", series: "TVmaze", movie: "TMDB" };

export default function MediaImportSearch({ type, initialQuery, onSelect, disabled }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ImportChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  // Parent wizard remounts this control when the media type changes.
  const selectResult = async (item: ImportChoice) => {
    if (type !== "series" || item.episodeCount) {
      onSelect(item); setOpen(false); setError(""); setQuery(item.title); return;
    }
    setLoading(true); setError("");
    let chosen = item;
    try {
      const response = await fetch("/api/admin/media-import?" + new URLSearchParams({ type: "series", details: item.externalId }), { cache: "no-store" });
      if (response.ok) {
        const metadata = await response.json() as { episodeCount?: number | null };
        if (typeof metadata.episodeCount === "number") chosen = { ...item, episodeCount: metadata.episodeCount };
      }
    } catch { /* Incomplete data is preferable to guessing. */ }
    onSelect(chosen); setOpen(false); setError(""); setQuery(item.title); setLoading(false);
  };
  const search = async () => {
    request.current?.abort();
    const signal = new AbortController();
    request.current = signal;
    const term = query.trim();
    if (term.length < 2) { setError("Enter at least two letters."); return; }
    setError(""); setOpen(true); setLoading(true); setResults([]);
    try {
      const response = await fetch("/api/admin/media-import?" + new URLSearchParams({ type, q: term }), {
        signal: signal.signal, cache: "no-store",
      });
      const body = await response.json() as { results?: ImportChoice[]; message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Search failed");
      if (!signal.signal.aborted) {
        setResults(body.results ?? []);
        if (body.message) setError(body.message);
      }
    } catch (cause) {
      if (!signal.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed");
    } finally {
      if (!signal.signal.aborted) setLoading(false);
    }
  };
  return (
    <section aria-label="Search and auto-fill media" className="min-w-0 rounded-2xl border border-violet-500/25 bg-gradient-to-br from-[#251935] via-[#181421] to-[#15131c] p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200">✦</span>
        <div>
          <h3 className="text-sm font-bold text-white">Find &amp; auto-fill</h3>
          <p className="text-[11px] text-neutral-400">Search {providerLabel[type]} — choose the correct title, then review before saving.</p>
        </div>
      </div>
      <div role="search" className="flex min-w-0 gap-2">
        <input aria-label="Search title to auto-fill" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
          disabled={disabled || loading} maxLength={100} placeholder="Enter anime, movie or series title"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-violet-400" />
        <button type="button" onClick={() => void search()} disabled={disabled || loading}
          className="min-h-11 shrink-0 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white transition hover:bg-violet-500 disabled:opacity-60">{loading ? "Finding…" : "Search"}</button>
      </div>
      {error && <p role="status" className="mt-2 text-xs text-amber-200">{error}</p>}
      {open && !loading && !error && !results.length && <p role="status" className="mt-2 text-xs text-neutral-400">No matches. You can still enter the details manually.</p>}
      {open && results.length > 0 && (
        <div aria-label="Metadata search results" className="mt-3 max-h-80 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-[#0f1019] p-1.5">
          {results.map((item) => (
            <button type="button" key={item.externalSource + ":" + item.externalId} disabled={disabled}
              onClick={() => { void selectResult(item); }}
              aria-label={"Use " + item.title + " details"}
              className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left transition hover:bg-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
              <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-neutral-800">
                <PosterImage src={item.posterUrl} title={item.title} sizes="40px" className="object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{item.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                  {item.year || "Year unknown"}{item.episodeCount ? " · " + item.episodeCount + " episodes" : ""}
                </span>
                {!!item.genres && <span className="block truncate text-[10px] text-violet-200/80">{item.genres}</span>}
              </span>
              <span className="rounded-lg bg-violet-500/20 px-2 py-1 text-[11px] font-semibold text-purple-200">Use</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-neutral-500">Optional. You can edit every imported field or add a title manually.</p>
    </section>
  );
}
