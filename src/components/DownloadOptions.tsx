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
              <span className="text-xs text-neutral-400">{versions.length} {versions.length === 1 ? "source" : "sources"}</span>
            </div>
            <div className="grid gap-2">
              {versions.map((link) => (
                <div key={link.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800/80 bg-neutral-950/60 px-3 py-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-xs font-medium text-neutral-200">{link.label?.trim() || (link.storageProvider === "r2" ? "Vault download" : "Download source")}</p>
                    <p className="text-[11px] text-neutral-400">
                      {link.fileSize?.trim() || (link.sizeBytes != null && link.sizeBytes > 0 ? `${(link.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : "Size unavailable")}
                      <span className="mx-1.5 text-neutral-600">·</span>{link.linkBehavior === "copy" ? "Copy link" : "Open link"}
                    </p>
                  </div>
                  <DownloadButton link={link} copyWebsite={copyWebsite} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
