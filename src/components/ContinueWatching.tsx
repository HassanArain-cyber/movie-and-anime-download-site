"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PosterImage from "./PosterImage";

type Entry = { mediaId: number; title: string; href: string; episodeNumber: number; posterUrl?: string | null; updatedAt: number };
const KEY = "vault-continue-episodes-v1";
const MAX_ENTRIES = 12;

function readEntries(): Entry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is Entry =>
      entry !== null && typeof entry === "object" &&
      typeof entry.mediaId === "number" && Number.isFinite(entry.mediaId) &&
      typeof entry.title === "string" && typeof entry.href === "string" &&
      /^\/(anime|series)\/[a-zA-Z0-9_-]+#episode-\d+$/.test(entry.href) &&
      typeof entry.episodeNumber === "number" && typeof entry.updatedAt === "number"
    ).slice(0, MAX_ENTRIES);
  } catch { return []; }
}

function broadcastChange() {
  window.dispatchEvent(new Event("vault-continue-updated"));
}

/** Remember an opened episode, not an unmeasured video-playback percentage. */
export function saveContinueEpisode(entry: Omit<Entry, "updatedAt">) {
  try {
    const next = [{ ...entry, updatedAt: Date.now() }, ...readEntries().filter((old) => old.mediaId !== entry.mediaId)].slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(next));
    broadcastChange();
  } catch { /* Private browsing may disable storage. */ }
}

function removeContinueEpisode(mediaId: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify(readEntries().filter((entry) => entry.mediaId !== mediaId)));
    broadcastChange();
  } catch { /* Storage may be disabled. */ }
}

export function ContinueWatching() {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const sync = () => setEntries(readEntries());
    sync();
    window.addEventListener("vault-continue-updated", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("vault-continue-updated", sync); window.removeEventListener("storage", sync); };
  }, []);
  if (!entries.length) return null;

  return (
    <section aria-label="Continue Watching" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="vault-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">Continue Watching</h2></div>
        <span className="text-[11px] text-neutral-400">Recently opened episodes · this device</span>
      </div>
      <div className="flex snap-x gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {entries.map((entry) => (
          <div key={entry.mediaId} className="group relative w-48 shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-[#191521] transition hover:border-violet-400/50 sm:w-56">
            <Link href={entry.href} aria-label={`Return to ${entry.title}, episode ${entry.episodeNumber}`} className="block min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400">
              <div className="relative h-28 overflow-hidden bg-neutral-900">
                <PosterImage src={entry.posterUrl || null} title={entry.title} sizes="(max-width: 640px) 192px, 224px" className="object-cover object-center opacity-65 transition duration-200 group-hover:scale-[1.04] group-hover:opacity-90" />
                <span className="absolute bottom-2 left-2 rounded-lg bg-black/75 px-2 py-1 text-[11px] font-semibold text-purple-100">Episode {entry.episodeNumber}</span>
              </div>
              <div className="p-3">
                <h3 className="truncate text-sm font-bold text-white">{entry.title}</h3>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-purple-300">Open episode <span aria-hidden="true">→</span></span>
              </div>
            </Link>
            <button type="button" onClick={() => removeContinueEpisode(entry.mediaId)} aria-label={`Remove ${entry.title} from Continue Watching`}
              title="Remove from this list"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-black/80 text-white transition hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
            ><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg></button>
          </div>
        ))}
      </div>
    </section>
  );
}
