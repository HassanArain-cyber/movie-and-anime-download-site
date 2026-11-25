/** Discovery helpers accept untrusted external catalog data. */
export function normalizeDiscoverQuery(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100)
    : "";
}

export function isPublicDiscoverAnime(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as { id?: unknown; isAdult?: unknown; title?: { english?: unknown; romaji?: unknown } };
  return item.isAdult === false &&
    typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0 &&
    !!item.title && (typeof item.title.english === "string" || typeof item.title.romaji === "string");
}

export function safeDiscoverUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function plainDiscoverDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim().slice(0, 6000);
}
