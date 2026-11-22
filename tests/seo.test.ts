import test from "node:test";
import assert from "node:assert/strict";
import {
  SITE_ORIGIN, mediaCanonicalUrl, mediaSeoMetadata, mediaStructuredData,
  publicPosterUrl, safeJsonLd, seoSummary,
} from "../src/lib/seo";

const firefly = {
  type: "anime" as const,
  title: "Firefly Wedding",
  slug: "firefly-wedding",
  year: 2026,
  genres: "Romance, Drama",
  description: "The story follows Satoko and Shinpei.",
  posterUrl: "https://img.example.org/firefly-poster.jpg",
};

test("anime/movie/series metadata is distinct and uses the Search Console canonical origin", () => {
  const anime = mediaSeoMetadata(firefly);
  assert.equal(anime.title, "Firefly Wedding (2026) | Gojo's Vault");
  assert.equal(anime.description, firefly.description);
  assert.deepEqual(anime.alternates, { canonical: SITE_ORIGIN + "/anime/firefly-wedding" });
  assert.equal(anime.openGraph?.url, SITE_ORIGIN + "/anime/firefly-wedding");
  assert.deepEqual(anime.twitter?.images, ["https://img.example.org/firefly-poster.jpg"]);
  assert.equal(anime.twitter?.card, "summary_large_image");
  assert.equal(mediaSeoMetadata({ ...firefly, type: "movie" }).alternates?.canonical, SITE_ORIGIN + "/movie/firefly-wedding");
  assert.equal(mediaSeoMetadata({ ...firefly, type: "series" }).alternates?.canonical, SITE_ORIGIN + "/series/firefly-wedding");
  assert.equal(mediaCanonicalUrl({ type: "anime", slug: "space anime" }), SITE_ORIGIN + "/anime/space%20anime");
});

test("metadata excludes unsafe poster URLs and never leaks object keys or credentials", () => {
  for (const url of ["data:image/png;base64,AAAA", "javascript:alert(1)", "http://img.example/file.jpg",
    "https://user:pass@example.org/file.jpg", "r2:///secret-object", "/api/download?id=8"]) {
    assert.equal(publicPosterUrl(url), undefined);
  }
  const r2 = "/api/image?upload=213e64b9-534a-4e38-bf5d-48e7d029c3b8";
  assert.equal(publicPosterUrl(r2), SITE_ORIGIN + r2);
  const meta = mediaSeoMetadata({ ...firefly, posterUrl: "r2:///secret-object" });
  assert.equal(meta.twitter?.card, "summary");
  assert.equal(meta.twitter?.images, undefined);
});

test("long synopsis is cleaned and safely truncated without rewriting the content", () => {
  const snippet = seoSummary("<p>Story</p>\n" + "arc ".repeat(100), "Fallback");
  assert.ok(snippet.startsWith("Story arc"));
  assert.ok(snippet.length <= 160);
  assert.ok(snippet.endsWith("…"));
  assert.equal(seoSummary(null, "Fallback"), "Fallback");
});

test("structured data uses only source fields and escapes inline scripts", () => {
  const schema = mediaStructuredData({ ...firefly, title: "</script><script>alert(1)</script>" });
  assert.equal(schema["@type"], "TVSeries");
  assert.deepEqual(schema.genre, ["Romance", "Drama"]);
  const serialized = safeJsonLd(schema);
  assert.ok(!serialized.includes("</script>"));
  assert.ok(serialized.includes("\\u003c"));
  assert.equal(mediaStructuredData({ ...firefly, type: "movie", genres: null })["@type"], "Movie");
});
