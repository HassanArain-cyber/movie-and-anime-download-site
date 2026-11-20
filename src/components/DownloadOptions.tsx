"use client";

import { useRef, useState } from "react";
import DownloadButton from "@/components/DownloadButton";
import { QUALITY_ORDER, formatBytes, getLinkHref, getLinkProvider, getProviderLabel, getQuality, qualityDisplay, isAudioOnlyDownload } from "@/lib/media-links";
import type { DownloadLink, VideoQuality } from "@/lib/types";

type GroupKey = VideoQuality | "unspecified";
const GROUP_ORDER: GroupKey[] = [...QUALITY_ORDER, "unspecified"];

function sourceTitle(link: DownloadLink, index: number, total: number): string {
  const custom = link.label?.trim();
  // A saved server name is useful; generic quality labels are not server names.
  if (custom && !/^(download|link|source|server|\d{3,4}p|2k|4k|8k|other quality)(\s*download)?$/i.test(custom)) return custom;
  const provider = getLinkProvider(link);
  const name = getProviderLabel(provider);
  return total > 1 ? `${name} · Source ${index + 1}` : name;
}

/** All real quality/source choices stay visible and usable. There are no invented links. */
export default function DownloadOptions({ links, copyWebsite }: { links: DownloadLink[]; copyWebsite?: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedKind, setSelectedKind] = useState<"video" | "audio">("video");
  const videoLinks = links.filter((link) => !isAudioOnlyDownload(link));
  const audioLinks = links.filter(isAudioOnlyDownload);
  const activeKind = selectedKind === "audio" && audioLinks.length ? "audio" : videoLinks.length ? "video" : "audio";
  const shownLinks = activeKind === "audio" ? audioLinks : videoLinks;
  const groups = new Map<GroupKey, DownloadLink[]>();
  for (const link of shownLinks) {
    const key = getQuality(link) || "unspecified";
    groups.set(key, [...(groups.get(key) || []), link]);
  }
  const available = GROUP_ORDER.filter((key) => groups.has(key));
  if (!available.length) return null;

  const jumpTo = (index: number) => {
    const target = rootRef.current?.querySelectorAll<HTMLElement>("[data-download-quality]")[index];
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  };

  return (
    <div ref={rootRef} className="vault-download-panel min-w-0 max-w-full overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-b from-[#1a1524] to-[#101017] shadow-[0_16px_42px_#00000035]">
      <div className="border-b border-white/10 px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-purple-200 ring-1 ring-purple-400/20">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 17v3h14v-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-white sm:text-base">Download options</h3>
              <p className="text-[11px] text-neutral-400">{shownLinks.length} {shownLinks.length === 1 ? "link" : "links"} · {available.length} {available.length === 1 ? "quality" : "qualities"} available</p>
            </div>
          </div>
          <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-purple-200">Choose quality</span>
        </div>
        {videoLinks.length > 0 && audioLinks.length > 0 && (
          <div className="mt-3 inline-flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1" role="group" aria-label="Download type">
            {(["video", "audio"] as const).map((kind) => (
              <button key={kind} type="button" onClick={() => setSelectedKind(kind)} aria-pressed={activeKind === kind}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${activeKind === kind ? "bg-violet-600 text-white shadow-sm" : "text-neutral-400 hover:bg-white/10 hover:text-white"}`}
              >{kind === "video" ? "Video" : "Audio"}</button>
            ))}
          </div>
        )}
        {available.length > 1 && (
          <div aria-label="Jump to download quality" className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {available.map((key, index) => (
              <button key={key} type="button" onClick={() => jumpTo(index)}
                className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:border-violet-400/60 hover:bg-violet-500/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >{key === "unspecified" ? "Other" : qualityDisplay(key)}</button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3 p-3 sm:p-4">
        {available.map((key) => {
          const versions = groups.get(key)!;
          return (
            <section key={key} data-download-quality className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-neutral-950/55">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-white/[0.035] px-3 py-2.5 sm:px-4">
                <h3 className="text-sm font-bold text-white">{key === "unspecified" && activeKind === "audio" ? "Audio files" : key === "unspecified" ? qualityDisplay(null) : qualityDisplay(key)}</h3>
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-200">{versions.length} {versions.length === 1 ? "source" : "sources"}</span>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {versions.map((link, index) => {
                  const size = link.fileSize?.trim() || (link.sizeBytes != null ? formatBytes(link.sizeBytes) : "");
                  const linkAvailable = Boolean(getLinkHref(link));
                  const stored = ["r2", "local"].includes(getLinkProvider(link));
                  const willCopy = link.linkBehavior === "copy" && !stored;
                  return (
                    <div key={link.id} className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-neutral-800/70 text-purple-200">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8M8 14h5" strokeLinecap="round" /></svg>
                        </span>
                        <div className="min-w-0">
                          <p className="break-words text-xs font-semibold text-neutral-100 sm:text-sm">{sourceTitle(link, index, versions.length)}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
                            <span>{size || "Size not provided"}</span><span aria-hidden="true" className="text-neutral-600">·</span>
                            <span>{!linkAvailable ? "Unavailable" : willCopy ? "Copies link" : stored ? "Direct file" : "Opens source"}</span>
                          </p>
                        </div>
                      </div>
                      <div className="w-full shrink-0 sm:w-auto"><DownloadButton link={link} copyWebsite={copyWebsite} compact /></div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
