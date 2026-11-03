import type { DownloadLink, StorageProvider, VideoQuality } from "./types";

// `quality` is already stored as varchar(10), so these additional presets do
// not require a schema change. Keep the order high-to-low for public choices.
export const QUALITIES: VideoQuality[] = ["4320p", "2160p", "1440p", "1080p", "720p", "480p", "360p", "other"];
export const QUALITY_ORDER: VideoQuality[] = [...QUALITIES];

export type BulkQualityChoice = "best" | VideoQuality | "unspecified";

export interface BulkEpisodeInput {
  id: number;
  episodeNumber: number;
  title: string | null;
  downloadLinks: DownloadLink[];
}

export interface BulkQueueEntry {
  episodeId: number;
  episodeNumber: number;
  title: string;
  status: "pending" | "skipped";
  message: string;
  link: DownloadLink | null;
}

const QUALITY_ALIASES: Record<string, VideoQuality> = {
  "360p": "360p", "480p": "480p", "720p": "720p", "1080p": "1080p",
  "1440p": "1440p", "2k": "1440p", "2160p": "2160p", "4k": "2160p",
  "4320p": "4320p", "8k": "4320p", other: "other",
};

/** Normalize common user-facing aliases into the canonical pixel-height value. */
export function normalizeQuality(value: unknown): VideoQuality | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(QUALITY_ALIASES, normalized) ? QUALITY_ALIASES[normalized] : null;
}

export function isR2Url(url: string): boolean {
  return url.startsWith("r2:///");
}

export function isLegacyUpload(url: string): boolean {
  return url.startsWith("/uploads/");
}

/** Never turn an old javascript:/data: record into a clickable link. */
export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:", "tg:", "magnet:"].includes(url.protocol)) return null;
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.hostname) return null;
    return value.trim();
  } catch {
    return null;
  }
}

export function getLinkProvider(link: Pick<DownloadLink, "url" | "storageProvider">): StorageProvider {
  if (isR2Url(link.url) || link.storageProvider === "r2") return "r2";
  if (isLegacyUpload(link.url)) return "local";
  if (link.storageProvider === "telegram") return "telegram";
  try {
    const url = new URL(link.url);
    if (url.protocol === "tg:" || ["t.me", "telegram.me", "telegram.dog"].includes(url.hostname.toLowerCase())) {
      return "telegram";
    }
  } catch { /* Legacy relative URLs are handled above. */ }
  return "external";
}

export function getProviderLabel(provider: StorageProvider): string {
  return { r2: "Cloudflare R2", local: "Legacy local file", external: "External link", telegram: "Telegram" }[provider];
}

export function getLinkHref(link: Pick<DownloadLink, "id" | "url" | "storageProvider">): string | null {
  const provider = getLinkProvider(link);
  return provider === "r2" || provider === "local" ? `/api/download?id=${link.id}` : safeExternalUrl(link.url);
}

export function getQuality(link: Pick<DownloadLink, "quality" | "label">): VideoQuality | null {
  const stored = normalizeQuality(link.quality);
  if (stored) return stored;
  const label = link.label || "";
  const patterns: [VideoQuality, RegExp][] = [
    ["4320p", /\b(?:4320p|8k)\b/i],
    ["2160p", /\b(?:2160p|4k)\b/i],
    ["1440p", /\b(?:1440p|2k)\b/i],
    ["1080p", /\b1080p?\b/i],
    ["720p", /\b720p?\b/i],
    ["480p", /\b480p?\b/i],
    ["360p", /\b360p?\b/i],
  ];
  for (const [quality, pattern] of patterns) if (pattern.test(label)) return quality;
  return null;
}

export function qualityDisplay(quality: VideoQuality | null): string {
  if (quality === "other") return "Other quality";
  if (quality === "1440p") return "2K (1440p)";
  if (quality === "2160p") return "4K (2160p)";
  if (quality === "4320p") return "8K (4320p)";
  return quality || "Unspecified quality";
}

function providerRank(link: DownloadLink): number {
  const provider = getLinkProvider(link);
  return provider === "r2" || provider === "local" ? 0 : 1;
}

/** Pick one safe link for each episode in a bulk action. Stored private/local
 * files win ties over external links so the queue uses the site's download flow.
 */
export function selectBulkDownload(links: DownloadLink[], choice: BulkQualityChoice): DownloadLink | null {
  const available = links.filter((link) => getLinkHref(link) !== null);
  if (choice !== "best") {
    const matches = available.filter((link) => {
      const quality = getQuality(link);
      return choice === "unspecified" ? quality === null : quality === choice;
    });
    return matches.sort((a, b) => providerRank(a) - providerRank(b) || a.id - b.id)[0] || null;
  }

  return available.sort((a, b) => {
    const aQuality = getQuality(a);
    const bQuality = getQuality(b);
    const aRank = aQuality ? QUALITY_ORDER.indexOf(aQuality) : QUALITY_ORDER.length;
    const bRank = bQuality ? QUALITY_ORDER.indexOf(bQuality) : QUALITY_ORDER.length;
    return aRank - bRank || providerRank(a) - providerRank(b) || a.id - b.id;
  })[0] || null;
}

/** Keep selected-episode order intact and retain an explicit entry for each
 * selected item, including unavailable qualities, so bulk progress is auditable. */
export function createBulkDownloadQueue(episodes: BulkEpisodeInput[], choice: BulkQualityChoice): BulkQueueEntry[] {
  return episodes.map((episode) => {
    const links = episode.downloadLinks || [];
    const link = selectBulkDownload(links, choice);
    const title = episode.title || `Episode ${episode.episodeNumber}`;
    if (link) return { episodeId: episode.id, episodeNumber: episode.episodeNumber, title, status: "pending", message: "Waiting in queue.", link };
    const reason = !links.some((candidate) => getLinkHref(candidate))
      ? "No safe, usable download link is available."
      : choice === "best"
        ? "No safe, usable download link is available."
        : `No ${choice === "unspecified" ? qualityDisplay(null) : qualityDisplay(choice)} version is available.`;
    return { episodeId: episode.id, episodeNumber: episode.episodeNumber, title, status: "skipped", message: reason, link: null };
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}

export function needsUnoptimizedImage(url: string): boolean {
  return /^(https?:|data:)/i.test(url) || url.startsWith("/api/image?");
}
