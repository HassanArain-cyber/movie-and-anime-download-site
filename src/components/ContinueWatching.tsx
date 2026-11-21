"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import PosterImage from "./PosterImage";

type Entry = { mediaId: number; title: string; href: string; episodeNumber: number; posterUrl?: string | null; updatedAt: number; totalEpisodes?: number };
const KEY = "vault-continue-episodes-v1";
const MAX_ENTRIES = 12;
const WATCHED_KEY = "vault-watched-episodes-v1";
const CHANGED = "vault-continue-updated";
function watchedSnapshot() {
  try { return localStorage.getItem(WATCHED_KEY) ?? "{}"; }
  catch { return "{}"; }
}
function subscribeWatched(change: () => void) {
  window.addEventListener(CHANGED, change);
  window.addEventListener("storage", change);
  return () => { window.removeEventListener(CHANGED, change); window.removeEventListener("storage", change); };
}
function watchedMap(): Record<string, number[]> {
  try {
    const value: unknown = JSON.parse(watchedSnapshot());
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const map: Record<string, number[]> = {};
    for (const [id, episodes] of Object.entries(value)) {
      if (/^\d+$/.test(id) && Array.isArray(episodes)) {
        map[id] = episodes.filter((v): v is number => Number.isSafeInteger(v) && v > 0).slice(0, 5000);
      }
    }
    return map;
  } catch { return {}; }
}
export function useWatchedEpisodeIds(mediaId: number) {
  const snapshot = useSyncExternalStore(subscribeWatched, watchedSnapshot, () => "{}");
  return useMemo(() => {
    try { const value = JSON.parse(snapshot) as Record<string, number[]>; return new Set(value[String(mediaId)] ?? []); }
    catch { return new Set<number>(); }
  }, [mediaId, snapshot]);
}
export function setEpisodeWatched(mediaId: number, episodeId: number, watched: boolean) {
  try {
    const map = watchedMap();
    const old = new Set(map[String(mediaId)] ?? []);
    if (watched) old.add(episodeId); else old.delete(episodeId);
    map[String(mediaId)] = [...old];
    localStorage.setItem(WATCHED_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(CHANGED));
  } catch { /* Private browsing may disable storage. */ }
}

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
    const previous = readEntries();
    const original = previous.find((item) => item.mediaId === entry.mediaId);
    const next = [{ ...original, ...entry, updatedAt: Date.now() }, ...previous.filter((old) => old.mediaId !== entry.mediaId)].slice(0, MAX_ENTRIES);
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
  const [watched, setWatched] = useState<Record<string, number[]>>({});
  useEffect(() => {
    const sync = () => { setEntries(readEntries()); setWatched(watchedMap()); };
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
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-purple-300">Resume from episode <span aria-hidden="true">→</span></span>
                <p className="mt-2 text-[11px] text-neutral-400">{watched[String(entry.mediaId)]?.length ?? 0}{entry.totalEpisodes ? " / " + entry.totalEpisodes : ""} episodes marked watched</p>
                {typeof entry.totalEpisodes === "number" && entry.totalEpisodes > 0 && (
                  <div role="progressbar" aria-label={`Episodes watched for ${entry.title}`} aria-valuenow={Math.min(watched[String(entry.mediaId)]?.length ?? 0, entry.totalEpisodes)} aria-valuemin={0} aria-valuemax={entry.totalEpisodes}
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: Math.min(100, ((watched[String(entry.mediaId)]?.length ?? 0) / entry.totalEpisodes) * 100) + "%" }} />
                  </div>
                )}
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
