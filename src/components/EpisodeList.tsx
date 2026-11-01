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
  selectBulkDownload,
  type BulkQualityChoice,
} from "@/lib/media-links";
import DownloadButton from "./DownloadButton";

interface BulkDownloadItem {
  episodeId: number;
  episodeNumber: number;
  title: string;
  status: "started" | "skipped" | "failed";
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

function missingReason(choice: BulkQualityChoice, hasAnyLinks: boolean): string {
  if (!hasAnyLinks) return "No download link is available.";
  if (choice === "best") return "No safe, usable download link is available.";
  return `No ${choiceLabel(choice)} version is available.`;
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
  const selectedAvailableCount = selectedEpisodes.filter((episode) => selectBulkDownload(episode.downloadLinks || [], bulkQuality)).length;

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

  const downloadSelected = async () => {
    if (bulkBusy || selectedEpisodes.length === 0) return;
    const requested = selectedEpisodes.length;
    const quality = choiceLabel(bulkQuality);
    const items: BulkDownloadItem[] = [];
    setBulkBusy(true);
    setBulkResult({ requested, quality, items: [] });

    for (let index = 0; index < selectedEpisodes.length; index += 1) {
      const episode = selectedEpisodes[index];
      const title = episode.title || `Episode ${episode.episodeNumber}`;
      const link = selectBulkDownload(episode.downloadLinks || [], bulkQuality);
      if (!link) {
        items.push({
          episodeId: episode.id,
          episodeNumber: episode.episodeNumber,
          title,
          status: "skipped",
          message: missingReason(bulkQuality, !!episode.downloadLinks?.length),
          link: null,
        });
      } else {
        const href = getLinkHref(link);
        if (!href) {
          items.push({ episodeId: episode.id, episodeNumber: episode.episodeNumber, title, status: "failed", message: "This link is not safe to open.", link });
        } else {
          try {
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.referrerPolicy = "no-referrer";
            const provider = getLinkProvider(link);
            if (provider === "r2" || provider === "local") anchor.download = "";
            else {
              anchor.target = "_blank";
              anchor.rel = "noopener noreferrer";
            }
            anchor.style.display = "none";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            const selectedQuality = getQuality(link);
            items.push({ episodeId: episode.id, episodeNumber: episode.episodeNumber, title, status: "started", message: `Sent to browser${selectedQuality ? ` · ${qualityDisplay(selectedQuality)}` : ""}.`, link });
          } catch {
            items.push({ episodeId: episode.id, episodeNumber: episode.episodeNumber, title, status: "failed", message: "The browser could not start this download.", link });
          }
        }
      }

      // Yield periodically so the queue indicator can update on large seasons.
      if (items.length % 5 === 0 || index === selectedEpisodes.length - 1) {
        setBulkResult({ requested, quality, items: [...items] });
        if (index !== selectedEpisodes.length - 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
    }
    setBulkBusy(false);
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
          <button type="button" onClick={() => void downloadSelected()} disabled={selectedEpisodes.length === 0 || bulkBusy} className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
            {bulkBusy ? `Starting downloads… ${bulkResult?.items.length || 0}/${bulkResult?.requested || selectedEpisodes.length}` : `Download Selected (${selectedEpisodes.length})`}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-neutral-500">Files are handed off individually to your browser, which manages transfer progress. Allow multiple downloads if prompted. Existing complete-season archives remain available above.</p>
      </div>

      {bulkResult && <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">Bulk download progress</h3>
            <p role="status" className="text-xs text-neutral-400">
              Download queue: {bulkResult.items.filter((item) => item.status === "started").length} started, {bulkResult.items.filter((item) => item.status === "skipped").length} skipped, {bulkResult.items.filter((item) => item.status === "failed").length} failed · {bulkResult.quality}
            </p>
          </div>
          <span className="text-xs text-neutral-500">{bulkResult.items.length} / {bulkResult.requested} processed</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-label="Bulk download queue progress" aria-valuemin={0} aria-valuemax={bulkResult.requested} aria-valuenow={bulkResult.items.length}>
          <div className="h-full bg-red-500 transition-all" style={{ width: `${bulkResult.requested ? Math.round((bulkResult.items.length / bulkResult.requested) * 100) : 0}%` }} />
        </div>
        <p className="text-xs text-neutral-500">Progress tracks handing files to the browser, not bytes transferred. Check your browser&apos;s download manager for transfer status; skipped or failed episodes can be opened individually below.</p>
        <ul className="space-y-2">
          {bulkResult.items.map((item) => {
            const episode = episodes.find((candidate) => candidate.id === item.episodeId);
            return (
              <li key={item.episodeId} className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-xs">
                <span className="font-medium text-neutral-200">Episode {item.episodeNumber}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-400">{item.title}</span>
                <span className={item.status === "started" ? "text-green-400" : item.status === "failed" ? "text-red-400" : "text-amber-400"}>{item.status}</span>
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
            <div key={ep.id} className="bg-neutral-900/40">
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
