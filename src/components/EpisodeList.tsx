"use client";

import { useState } from "react";
import DownloadButton from "./DownloadButton";
import type { EpisodeWithLinks, VideoQuality } from "@/lib/types";
import { getQuality, qualityDisplay } from "@/lib/media-links";

export default function EpisodeList({ episodes }: { episodes: EpisodeWithLinks[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!episodes?.length) return <p className="rounded-md bg-neutral-900 p-4 text-sm text-neutral-500 ring-1 ring-neutral-800">No episodes added to this season.</p>;

  return (
    <div className="divide-y divide-neutral-900 overflow-hidden rounded-lg ring-1 ring-neutral-800">
      {episodes.map((ep) => {
        const open = openId === ep.id;
        const groups = new Map<VideoQuality | "unspecified", typeof ep.downloadLinks>();
        for (const link of ep.downloadLinks || []) {
          const key = getQuality(link) || "unspecified";
          groups.set(key, [...(groups.get(key) || []), link]);
        }
        const order: (VideoQuality | "unspecified")[] = ["1080p", "720p", "other", "unspecified"];
        return (
          <div key={ep.id} className="bg-neutral-900/40">
            <button type="button" onClick={() => setOpenId(open ? null : ep.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-900">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-xs font-semibold text-neutral-300">{ep.episodeNumber}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{ep.title || `Episode ${ep.episodeNumber}`}</p>
                {ep.duration && <p className="text-xs text-neutral-500">{ep.duration}</p>}
              </div>
              <svg className={`h-4 w-4 shrink-0 text-neutral-500 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {open && <div className="space-y-3 border-t border-neutral-800 bg-neutral-950 px-4 py-3">
              {!ep.downloadLinks?.length && <p className="text-sm text-neutral-500">No download links for this episode.</p>}
              {order.filter((key) => groups.has(key)).map((key) => (
                <div key={key} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{key === "unspecified" ? "Downloads" : qualityDisplay(key)}</p>
                  <div className="flex flex-wrap gap-2">{groups.get(key)!.map((link) => <DownloadButton key={link.id} link={link} />)}</div>
                </div>
              ))}
            </div>}
          </div>
        );
      })}
    </div>
  );
}
