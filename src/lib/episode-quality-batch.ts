import { getQuality, safeExternalUrl } from "./media-links";
import type { EpisodeWithLinks, VideoQuality } from "./types";

/** Adapt inclusive start/end input to the existing start/count batch API. */
export function episodeRange(startText: string, endText: string): { start: number; count: number } {
  const start = Number(startText), end = Number(endText);
  if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 100000) {
    throw new Error("Enter a valid start/end range between 1 and 100000; end must be at least start.");
  }
  const count = end - start + 1;
  if (count > 500) throw new Error("Create up to 500 episodes per range. Use another range for additional episodes.");
  return { start, count };
}

export function qualityLinks(episode: EpisodeWithLinks, quality: VideoQuality) {
  return episode.downloadLinks.filter((link) => getQuality(link) === quality);
}

export function validateEpisodeLink(url: string): string | null {
  if (!url.trim()) return null; // Empty rows are deliberately skipped.
  return safeExternalUrl(url.trim()) ? null : "Use an HTTP(S), Telegram, or magnet link.";
}

export type LinkResult = { state: "saving" | "saved" | "error" | "exists"; message: string };

/** Never PATCH an existing quality. Re-reading before every retry reconciles lost responses. */
export async function saveEpisodeQualityLink(episode: EpisodeWithLinks, quality: VideoQuality, url: string, create: () => Promise<void>): Promise<LinkResult> {
  const existing = qualityLinks(episode, quality);
  if (existing.some((link) => link.url === url.trim())) return { state: "saved", message: "Saved" };
  if (existing.length) return { state: "exists", message: "Quality already has a link. Use the individual episode editor to change it." };
  try {
    await create();
    return { state: "saved", message: "Saved" };
  } catch (reason) {
    return { state: "error", message: reason instanceof Error ? reason.message : "Could not save this link. Retry to check whether it was saved." };
  }
}
