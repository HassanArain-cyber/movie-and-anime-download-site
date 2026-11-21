import { isIP } from "node:net";

export type LinkHealth = "reachable" | "broken" | "review";
export type LinkCheck = { status: LinkHealth; reason: string };

/** A 2xx response proves that a server answered, not that a file was downloaded. */
export function classifyHeadStatus(code: number): LinkCheck {
  if (code >= 200 && code < 300) return { status: "reachable", reason: "Provider responded to a HEAD request." };
  if (code === 404 || code === 410) return { status: "broken", reason: "Provider reports Not Found or Gone." };
  if (code >= 300 && code < 400) return { status: "review", reason: "Provider redirects; final destination was not checked." };
  return { status: "review", reason: "Provider returned HTTP " + code + "; this may block automated checks." };
}

/**
 * DNS resolution can return private addresses even for a public hostname.
 * This intentionally supports public IPv4 only; unsupported IPv6 is not probed.
 */
export function isPublicIPv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Never probe arbitrary ports, IP literals, localhost, or non-HTTPS schemes. */
export function safeProbeUrl(raw: string): URL | null {
  if (raw.length > 4096) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !host.includes(".") ||
      url.username || url.password || isIP(host) !== 0 ||
      (url.port && url.port !== "443") ||
      host.endsWith(".local") || host.endsWith(".localhost") ||
      host.endsWith(".internal") || host.endsWith(".test") ||
      host.endsWith(".invalid") || host.endsWith(".example") ||
      !/^[a-z0-9.-]+$/.test(host)) return null;
  return url;
}

/**
 * Build an internal media detail link for an Admin audit result.
 * Only known content types are accepted; slug is encoded as one path segment.
 * Episode links jump directly to the matching episode on anime/series pages.
 */
export function getMediaAuditHref(
  type: string | null, slug: string | null, episodeId: number | null,
): string | null {
  if (type !== "anime" && type !== "movie" && type !== "series") return null;
  if (!slug || slug.length > 255 || /[\\u0000-\\u001f\\u007f]/.test(slug)) return null;
  try {
    const base = "/" + type + "/" + encodeURIComponent(slug);
    const episodeAnchor = type !== "movie" &&
      Number.isSafeInteger(episodeId) && (episodeId ?? 0) > 0
      ? "#episode-" + episodeId : "";
    return base + episodeAnchor;
  } catch {
    return null;
  }
}
