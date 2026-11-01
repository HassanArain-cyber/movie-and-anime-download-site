"use client";

import { useState } from "react";
import DownloadButton from "./DownloadButton";
import type { EpisodeWithLinks } from "@/lib/types";

export default function EpisodeList({
  episodes,
}: {
  episodes: EpisodeWithLinks[];
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (!episodes || episodes.length === 0) {
    return (
      <p className="rounded-md bg-neutral-900 p-4 text-sm text-neutral-500 ring-1 ring-neutral-800">
        No episodes added to this season.
      </p>
    );
  }

  return (
    <div className="divide-y divide-neutral-900 overflow-hidden rounded-lg ring-1 ring-neutral-800">
      {episodes.map((ep) => {
        const open = openId === ep.id;
        return (
          <div key={ep.id} className="bg-neutral-900/40">
            <button
              onClick={() => setOpenId(open ? null : ep.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-900"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-xs font-semibold text-neutral-300">
                {ep.episodeNumber}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {ep.title || `Episode ${ep.episodeNumber}`}
                </p>
                {ep.duration && (
                  <p className="text-xs text-neutral-500">{ep.duration}</p>
                )}
              </div>
              <svg
                className={`h-4 w-4 shrink-0 text-neutral-500 transition ${
                  open ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {open && (
              <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
                {ep.downloadLinks.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    No download links for this episode.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {ep.downloadLinks.map((link) => (
                      <DownloadButton key={link.id} link={link} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
