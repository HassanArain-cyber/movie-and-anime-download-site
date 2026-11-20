"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Entry = { mediaId: number; title: string; href: string; episodeNumber: number; updatedAt: number };
const KEY = "vault-continue-episodes-v1";
function readEntries(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is Entry => entry && typeof entry.mediaId === "number" && typeof entry.title === "string" && typeof entry.href === "string" && /^\/(anime|series)\/[a-zA-Z0-9_-]+#episode-\d+$/.test(entry.href) && typeof entry.episodeNumber === "number" && typeof entry.updatedAt === "number").slice(0, 12);
  } catch { return []; }
}
export function saveContinueEpisode(entry: Omit<Entry, "updatedAt">) {
  try {
    const next = [{ ...entry, updatedAt: Date.now() }, ...readEntries().filter((old) => old.mediaId !== entry.mediaId)].slice(0, 12);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("vault-continue-updated"));
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
  return <section aria-label="Continue episodes" className="space-y-3">
    <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-white">Continue Watching</h2><span className="text-xs text-neutral-400">Saved in this browser</span></div>
    <div className="flex snap-x gap-3 overflow-x-auto pb-2">{entries.map((entry) => <Link key={entry.mediaId} href={entry.href} className="min-w-44 max-w-60 flex-1 shrink-0 snap-start rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 transition hover:border-violet-500">
      <p className="truncate text-sm font-semibold text-white">{entry.title}</p><p className="mt-2 text-xs text-purple-300">Episode {entry.episodeNumber}</p><p className="mt-3 text-xs text-neutral-400">Continue →</p>
    </Link>)}</div>
  </section>;
}
