import type { DownloadLink, StorageProvider, VideoQuality } from "./types";

export const QUALITIES: VideoQuality[] = ["720p", "1080p", "other"];

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
  if (link.quality && QUALITIES.includes(link.quality)) return link.quality;
  const label = link.label || "";
  if (/\b1080p?\b/i.test(label)) return "1080p";
  if (/\b720p?\b/i.test(label)) return "720p";
  return null;
}

export function qualityDisplay(quality: VideoQuality | null): string {
  return quality === "other" ? "Other quality" : quality || "Unspecified quality";
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
