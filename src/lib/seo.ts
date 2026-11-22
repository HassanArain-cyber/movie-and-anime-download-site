import type { Metadata } from "next";
import type { Media } from "./types";

// The URL Prefix already verified in Google Search Console. All canonical URLs,
// sitemap entries and social sharing metadata must use this same origin.
export const SITE_ORIGIN = "https://movie-and-anime-download-site.vercel.app";
export const SITE_NAME = "Gojo's Vault";

type SeoMedia = Pick<Media, "type" | "title" | "slug" | "description" | "posterUrl" | "year" | "genres">;

export function mediaCanonicalUrl(item: Pick<SeoMedia, "type" | "slug">): string {
  return SITE_ORIGIN + "/" + item.type + "/" + encodeURIComponent(item.slug);
}

/** Keep generated snippets readable, bounded, and independent of HTML markup. */
export function seoSummary(value: string | null | undefined, fallback: string, limit = 160): string {
  const cleaned = (value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const text = cleaned || fallback;
  if (text.length <= limit) return text;
  return (text.slice(0, limit - 1).replace(/\s+\S*$/, "").trimEnd() || text.slice(0, limit - 1)) + "…";
}

/**
 * Public poster only. Do not expose data URIs, arbitrary schemes, credentialed
 * hosts, or private object keys in metadata. R2 images use the existing public
 * completed-image redirect endpoint rather than a time-limited signed URL.
 */
export function publicPosterUrl(value: string | null | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  if (/^\/api\/image\?upload=[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    return SITE_ORIGIN + value;
  }
  if (/^\/uploads\/[a-z0-9_./-]+\.(?:jpg|jpeg|png|webp|gif)$/i.test(value) && !value.includes("..")) {
    return SITE_ORIGIN + value;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function mediaSeoMetadata(item: SeoMedia): Metadata {
  const typeLabel = item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "TV series";
  const year = Number.isInteger(item.year) && (item.year ?? 0) > 1800 ? " (" + item.year + ")" : "";
  const title = item.title + year + " | " + SITE_NAME;
  const details = item.type === "movie" ? "film synopsis and information" : "synopsis, seasons and episode information";
  const description = seoSummary(item.description,
    "Explore " + item.title + year + " — " + typeLabel + " " + details + " on " + SITE_NAME + ".");
  const url = mediaCanonicalUrl(item);
  const image = publicPosterUrl(item.posterUrl);
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: {
      type: "website", siteName: SITE_NAME, title, description, url,
      ...(image ? { images: [{ url: image, alt: item.title + " poster" }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary", title, description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/** JSON-LD uses only known catalog facts; no invented release dates or ratings. */
export function mediaStructuredData(item: SeoMedia) {
  const genres = (item.genres || "").split(",").map((genre) => genre.trim()).filter(Boolean);
  const description = seoSummary(item.description, item.title + " on " + SITE_NAME, 600);
  const image = publicPosterUrl(item.posterUrl);
  return {
    "@context": "https://schema.org",
    "@type": item.type === "movie" ? "Movie" : "TVSeries",
    name: item.title,
    description,
    url: mediaCanonicalUrl(item),
    ...(genres.length ? { genre: genres } : {}),
    ...(image ? { image } : {}),
  };
}

/** Prevent stored synopsis/title text from closing a JSON-LD script element. */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
