"use client";

import { useState } from "react";
import DownloadOptions from "./DownloadOptions";
import type { DownloadLink, EpisodeWithLinks, VideoQuality } from "@/lib/types";
import {
  getLinkHref,
  getLinkProvider,
  getQuality,
  QUALITY_ORDER,
  qualityDisplay,
  createBulkDownloadQueue,
  type BulkQualityChoice,
} from "@/lib/media-links";
import DownloadButton from "./DownloadButton";

interface BulkDownloadItem {
  episodeId: number;
  episodeNumber: number;
  title: string;
  status: "pending" | "completed" | "skipped" | "failed";
  message: string;
  link: DownloadLink | null;
}

interface BulkDownloadResult {
  requested: number;
  quality: string;
  items: BulkDownloadItem[];
}

function choiceLabel(choice: BulkQualityChoice): string {
  if (choice === "best") return "Best available per episode";
  if (choice === "unspecified") return qualityDisplay(null);
  return qualityDisplay(choice);
}

export default function EpisodeList({ episodes }: { episodes: EpisodeWithLinks[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkQuality, setBulkQuality] = useState<BulkQualityChoice>("best");
  const [bulkResult, setBulkResult] = useState<BulkDownloadResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  if (!episodes?.length) return <p className="rounded-md bg-neutral-900 p-4 text-sm text-neutral-500 ring-1 ring-neutral-800">No episodes added to this season.</p>;

  const selectedEpisodes = episodes.filter((episode) => selectedIds.has(episode.id));
  const availableQualities = new Set<VideoQuality>();
  let hasUnspecified = false;
  for (const episode of episodes) {
    for (const link of episode.downloadLinks || []) {
      if (!getLinkHref(link)) continue;
      const quality = getQuality(link);
      if (quality) availableQualities.add(quality);
      else hasUnspecified = true;
    }
  }
  const selectedAvailableCount = selectedEpisodes.filter((episode) => createBulkDownloadQueue([episode], bulkQuality)[0]?.status === "pending").length;

  const toggleEpisode = (id: number, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setBulkResult(null);
  };

  const selectAll = () => {
    setSelectedIds(new Set(episodes.map((episode) => episode.id)));
    setBulkResult(null);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkResult(null);
  };

  const launchNext = (queue: BulkDownloadItem[], result: BulkDownloadResult) => {
    const nextQueue = [...queue];
    const index = nextQueue.findIndex((item) => item.status === "pending");
    if (index < 0) {
      setBulkBusy(false);
      setBulkResult({ ...result, items: nextQueue });
      return;
    }

    const item = nextQueue[index];
    const href = item.link ? getLinkHref(item.link) : null;
    if (!href || !item.link) {
      nextQueue[index] = { ...item, status: "failed", message: "This link is not safe to open." };
    } else {
      try {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.referrerPolicy = "no-referrer";
        const provider = getLinkProvider(item.link);
        if (provider === "r2" || provider === "local") anchor.download = "";
        else {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        const selectedQuality = getQuality(item.link);
        nextQueue[index] = { ...item, status: "completed", message: `Handed to browser${selectedQuality ? ` · ${qualityDisplay(selectedQuality)}` : ""}.` };
      } catch {
        nextQueue[index] = { ...item, status: "failed", message: "The browser could not start this download." };
      }
    }

    setBulkResult({ ...result, items: nextQueue });
    setBulkBusy(nextQueue.some((entry) => entry.status === "pending"));
  };

  const downloadSelected = () => {
    if (selectedEpisodes.length === 0) return;
    if (bulkBusy && bulkResult) {
      launchNext(bulkResult.items, bulkResult);
      return;
    }
    const items = createBulkDownloadQueue(selectedEpisodes, bulkQuality) as BulkDownloadItem[];
    const result = { requested: selectedEpisodes.length, quality: choiceLabel(bulkQuality), items };
    setBulkResult(result);
    setBulkBusy(items.some((item) => item.status === "pending"));
    // One file per explicit click keeps each handoff inside a fresh user gesture.
    // Browsers can block synthetic multiple-download bursts without user approval.
    launchNext(items, result);
  };

  const order: (VideoQuality | "unspecified")[] = [...QUALITY_ORDER, "unspecified"];

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Select episodes</h3>
            <p className="text-xs text-neutral-500">Choose any episodes in this season for individual downloads.</p>
          </div>
          <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300" aria-live="polite">{selectedEpisodes.length} selected</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1 text-xs text-neutral-400">
            Bulk download quality
            <select
              value={bulkQuality}
              onChange={(event) => { setBulkQuality(event.target.value as BulkQualityChoice); setBulkResult(null); }}
              disabled={bulkBusy}
              className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700 disabled:opacity-50 sm:max-w-sm"
            >
              <option value="best">Best available per episode</option>
              {order.filter((quality) => quality === "unspecified" ? hasUnspecified : availableQualities.has(quality)).map((quality) => (
                <option key={quality} value={quality}>{quality === "unspecified" ? qualityDisplay(null) : qualityDisplay(quality)}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-500 sm:max-w-xs sm:pb-2">
            {selectedEpisodes.length === 0
              ? "Select episodes to see availability."
              : `${selectedAvailableCount} of ${selectedEpisodes.length} selected episodes match this choice; the rest will be skipped.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={selectAll} disabled={bulkBusy} className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">Select All</button>
          <button type="button" onClick={clearSelection} disabled={selectedEpisodes.length === 0 || bulkBusy} className="rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50">Clear Selection</button>
          <button type="button" onClick={downloadSelected} disabled={selectedEpisodes.length === 0} className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
            {bulkBusy ? `Download next (${bulkResult?.items.filter((item) => item.status === "pending").length || 0} remaining)` : `Download Selected (${selectedEpisodes.length})`}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-neutral-500">To avoid browser multiple-download blocking, each click starts one queued episode; click Download next until the queue is complete. The browser manages transfer progress. Existing complete-season archives remain available above.</p>
      </div>

      {bulkResult && <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Bulk download progress</h3>
            <p role="status" className="text-xs text-neutral-400">
              Download queue: {bulkResult.items.filter((item) => item.status === "completed").length} completed (handed to browser), {bulkResult.items.filter((item) => item.status === "pending").length} waiting, {bulkResult.items.filter((item) => item.status === "skipped").length} skipped, {bulkResult.items.filter((item) => item.status === "failed").length} failed · {bulkResult.quality}
            </p>
          </div>
          <span className="text-xs text-neutral-500">{bulkResult.items.filter((item) => item.status !== "pending").length} / {bulkResult.requested} processed</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-label="Bulk download queue progress" aria-valuemin={0} aria-valuemax={bulkResult.requested} aria-valuenow={bulkResult.items.filter((item) => item.status !== "pending").length}>
          <div className="h-full bg-red-500 transition-all" style={{ width: `${bulkResult.requested ? Math.round((bulkResult.items.filter((item) => item.status !== "pending").length / bulkResult.requested) * 100) : 0}%` }} />
        </div>
        <p className="text-xs text-neutral-500">Progress tracks queue handoffs, not bytes transferred. The site cannot detect network failures after the browser accepts a file; check its download manager. Skipped or failed episodes can be opened individually below.</p>
        <ul className="space-y-2">
          {bulkResult.items.map((item) => {
            const episode = episodes.find((candidate) => candidate.id === item.episodeId);
            return (
              <li key={item.episodeId} className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-xs">
                <span className="font-medium text-neutral-200">Episode {item.episodeNumber}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-400">{item.title}</span>
                <span className={item.status === "completed" ? "text-green-400" : item.status === "failed" ? "text-red-400" : "text-amber-400"}>{item.status}</span>
                <span className="w-full text-neutral-500">{item.message}</span>
                {item.status === "failed" && item.link && <DownloadButton link={item.link} />}
                {item.status === "skipped" && episode?.downloadLinks?.length ? (
                  <button type="button" onClick={() => setOpenId(episode.id)} className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:text-white">View episode links</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>}

      <div className="divide-y divide-neutral-900 overflow-hidden rounded-lg ring-1 ring-neutral-800">
        {episodes.map((ep) => {
          const open = openId === ep.id;
          return (
            <div key={ep.id} id={`episode-${ep.id}`} className="scroll-mt-24 bg-neutral-900/40">
              <div className="flex items-center gap-1 px-2 py-1 sm:gap-3 sm:px-4 sm:py-2">
                <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-neutral-800" title={`Select Episode ${ep.episodeNumber}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(ep.id)}
                    disabled={bulkBusy}
                    onChange={(event) => toggleEpisode(ep.id, event.target.checked)}
                    aria-label={`Select episode ${ep.episodeNumber} for bulk download`}
                    className="h-4 w-4 accent-red-500"
                  />
                </label>
                <button type="button" onClick={() => setOpenId(open ? null : ep.id)} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left hover:bg-neutral-900 sm:px-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-xs font-semibold text-neutral-300">{ep.episodeNumber}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{ep.title || `Episode ${ep.episodeNumber}`}</p>
                    {ep.duration && <p className="text-xs text-neutral-500">{ep.duration}</p>}
                  </div>
                  <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">{ep.downloadLinks?.length || 0} versions</span>
                  <svg className={`h-4 w-4 shrink-0 text-neutral-500 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>
              {open && <div className="space-y-3 border-t border-neutral-800 bg-neutral-950 px-3 py-3 sm:px-4">
                {!ep.downloadLinks?.length && <p className="text-sm text-neutral-500">No download links for this episode.</p>}
                {!!ep.downloadLinks?.length && <DownloadOptions links={ep.downloadLinks} />}
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
