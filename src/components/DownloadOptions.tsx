"use client";

import DownloadButton from "@/components/DownloadButton";
import { QUALITY_ORDER, getQuality, qualityDisplay } from "@/lib/media-links";
import type { DownloadLink, VideoQuality } from "@/lib/types";

type GroupKey = VideoQuality | "unspecified";
const GROUP_ORDER: GroupKey[] = [...QUALITY_ORDER, "unspecified"];

/** Render every independently selectable version while keeping legacy links visible. */
export default function DownloadOptions({ links, copyWebsite }: { links: DownloadLink[]; copyWebsite?: string | null }) {
  const groups = new Map<GroupKey, DownloadLink[]>();
  for (const link of links) {
    const key = getQuality(link) || "unspecified";
    groups.set(key, [...(groups.get(key) || []), link]);
  }

  return (
    <div className="min-w-0 max-w-full space-y-3">
      {GROUP_ORDER.filter((key) => groups.has(key)).map((key) => {
        const versions = groups.get(key)!;
        return (
          <section key={key} className="min-w-0 max-w-full rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">{key === "unspecified" ? qualityDisplay(null) : qualityDisplay(key)}</h3>
              <span className="text-xs text-neutral-500">{versions.length} {versions.length === 1 ? "version" : "versions"}</span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {versions.map((link) => <DownloadButton key={link.id} link={link} copyWebsite={copyWebsite} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
