import assert from "node:assert/strict";
import test from "node:test";
import { SITE_ORIGIN, mediaSeoMetadata, socialPosterUrl } from "../src/lib/seo";

const uploadId = "71c6fcae-1433-4608-83f0-4b43edb31d55";
const r2Image = "/api/image?upload=" + uploadId;

test("R2 posters use an updated, stable publicly readable social JPEG URL", () => {
  assert.equal(socialPosterUrl(r2Image),
    SITE_ORIGIN + "/api/seo-poster?upload=" + uploadId + "&v=2");
  assert.equal(socialPosterUrl("javascript:alert(1)"), undefined);
});

test("Anime Open Graph metadata exposes the original title with a social JPEG preview", () => {
  const metadata = mediaSeoMetadata({
    type: "anime", title: "Blue Box", slug: "blue-box",
    description: "An anime synopsis", posterUrl: r2Image,
    year: 2024, genres: "Sports",
  });
  assert.equal(metadata.title, "Blue Box (2024) | Gojo's Vault");
  const openGraph = metadata.openGraph;
  assert.ok(openGraph);
  assert.equal(openGraph.images && Array.isArray(openGraph.images) && openGraph.images[0]?.url,
    SITE_ORIGIN + "/api/seo-poster?upload=" + uploadId + "&v=2");
  assert.equal(openGraph.images && Array.isArray(openGraph.images) && openGraph.images[0]?.type,
    "image/jpeg");
});
