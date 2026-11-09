import test from "node:test";
import assert from "node:assert/strict";
import { episodeRange, qualityLinks, saveEpisodeQualityLink, validateEpisodeLink } from "../src/lib/episode-quality-batch";
import type { EpisodeWithLinks, DownloadLink } from "../src/lib/types";

const link = (quality: "720p" | "1080p", url = "https://example.com/old.mp4"): DownloadLink => ({ id: 1, mediaId: 1, seasonId: 1, episodeId: 1, quality, url, label: quality, fileSize: null, isUploaded: false, storageProvider: "external", objectKey: null, sizeBytes: null, linkBehavior: "open" });
const episode = (links: DownloadLink[] = []): EpisodeWithLinks => ({ id: 1, mediaId: 1, seasonId: 1, episodeNumber: 1, title: "Episode 1", duration: null, downloadLinks: links });

test("inclusive ranges adapt to existing batch API and allow 1–100 without a schema change", () => {
  assert.deepEqual(episodeRange("1", "12"), { start: 1, count: 12 });
  assert.deepEqual(episodeRange("1", "100"), { start: 1, count: 100 });
  assert.deepEqual(episodeRange("15", "15"), { start: 15, count: 1 });
  for (const [start, end] of [["0", "12"], ["12", "1"], ["", "1"], ["1.5", "10"], ["1", "501"], ["1", "100001"]]) assert.throws(() => episodeRange(start, end));
});

test("blank link rows are skipped and external links use existing safety policy", () => {
  assert.equal(validateEpisodeLink(" "), null);
  assert.equal(validateEpisodeLink("https://example.com/a.mp4"), null);
  assert.equal(validateEpisodeLink("https://t.me/example/1"), null);
  assert.ok(validateEpisodeLink("javascript:alert(1)"));
  assert.ok(validateEpisodeLink("/uploads/video.mp4"));
});

test("adding another quality does not overwrite any existing quality record", async () => {
  const old = link("720p"); const item = episode([old]); let created = 0;
  const result = await saveEpisodeQualityLink(item, "1080p", "https://example.com/1080.mp4", async () => { created++; item.downloadLinks.push(link("1080p", "https://example.com/1080.mp4")); });
  assert.equal(result.state, "saved"); assert.equal(created, 1);
  assert.equal(item.downloadLinks[0], old);
  assert.equal(qualityLinks(item, "720p")[0].url, "https://example.com/old.mp4");
  assert.equal(qualityLinks(item, "1080p")[0].url, "https://example.com/1080.mp4");
});

test("same-quality links and legacy quality labels are protected, not patched or duplicated", async () => {
  const existing = link("720p"); existing.quality = null;
  const item = episode([existing]); let creates = 0;
  assert.equal((await saveEpisodeQualityLink(item, "720p", "https://example.com/new.mp4", async () => { creates++; })).state, "exists");
  assert.equal((await saveEpisodeQualityLink(item, "720p", existing.url, async () => { creates++; })).state, "saved");
  assert.equal(creates, 0); assert.equal(item.downloadLinks.length, 1);
});

test("partial failures can be retried and lost attachment responses are reconciled", async () => {
  const first = episode(), second = episode();
  assert.equal((await saveEpisodeQualityLink(first, "720p", "https://example.com/1.mp4", async () => { first.downloadLinks.push(link("720p", "https://example.com/1.mp4")); })).state, "saved");
  const result = await saveEpisodeQualityLink(second, "720p", "https://example.com/2.mp4", async () => { second.downloadLinks.push(link("720p", "https://example.com/2.mp4")); throw Error("Response lost"); });
  assert.equal(result.state, "error");
  let retries = 0;
  assert.equal((await saveEpisodeQualityLink(second, "720p", "https://example.com/2.mp4", async () => { retries++; })).state, "saved");
  assert.equal(retries, 0); assert.equal(first.downloadLinks.length, 1); assert.equal(second.downloadLinks.length, 1);
});
