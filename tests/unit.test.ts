import test from "node:test";
import assert from "node:assert/strict";
import {
  createBulkDownloadQueue,
  formatBytes,
  getLinkHref,
  getLinkProvider,
  getQuality,
  qualityDisplay,
  safeExternalUrl,
  selectBulkDownload,
} from "../src/lib/media-links";
import { positiveId, quality, ApiError } from "../src/lib/validation";
import { validateContactRequest } from "../src/lib/contact-request";
import type { DownloadLink } from "../src/lib/types";

test("external URL safety preserves Telegram and magnet links but blocks scripts", () => {
  assert.equal(safeExternalUrl("https://t.me/channel/123"), "https://t.me/channel/123");
  assert.equal(safeExternalUrl("tg://resolve?domain=channel"), "tg://resolve?domain=channel");
  assert.ok(safeExternalUrl("magnet:?xt=urn:btih:abc"));
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("data:text/html,hi"), null);
});

test("stored links use the download handler and unsafe legacy links are not clickable", () => {
  const base = { id: 7, mediaId: 1, seasonId: null, episodeId: null, label: "1080p", fileSize: null, isUploaded: true, quality: "1080p" as const, storageProvider: "r2" as const, objectKey: "videos/a.mp4", sizeBytes: 10 };
  assert.equal(getLinkHref({ ...base, url: "r2:///videos/a.mp4" }), "/api/download?id=7");
  assert.equal(getLinkProvider({ ...base, url: "/uploads/videos/a.mp4", storageProvider: null }), "local");
  assert.equal(getLinkHref({ ...base, url: "javascript:alert(1)", storageProvider: null }), null);
});

test("quality values accept common resolutions and 2K/4K/8K aliases", () => {
  assert.equal(getQuality({ quality: null, label: "WEB-DL 1080p" }), "1080p");
  assert.equal(getQuality({ quality: "720p", label: "anything" }), "720p");
  assert.equal(getQuality({ quality: null, label: "WEB-DL 2K" }), "1440p");
  assert.equal(getQuality({ quality: null, label: "2160p UHD" }), "2160p");
  assert.equal(quality("480p"), "480p");
  assert.equal(quality("4K"), "2160p");
  assert.equal(quality("other"), "other");
  assert.equal(qualityDisplay("1440p"), "2K (1440p)");
  assert.throws(() => quality("cinema"), ApiError);
});

test("bulk selection picks the chosen quality, highest available, and legacy unspecified links", () => {
  const base: Omit<DownloadLink, "id" | "url" | "quality" | "label" | "storageProvider"> = {
    mediaId: 1, seasonId: null, episodeId: 10, fileSize: null, isUploaded: false, objectKey: null, sizeBytes: null,
  };
  const links: DownloadLink[] = [
    { ...base, id: 1, url: "https://example.com/720.mp4", label: "720p", quality: "720p", storageProvider: "external" },
    { ...base, id: 2, url: "r2:///videos/4k.mp4", label: "4K", quality: "2160p", storageProvider: "r2" },
    { ...base, id: 3, url: "https://example.com/legacy.mp4", label: "Download", quality: null, storageProvider: "external" },
  ];
  assert.equal(selectBulkDownload(links, "best")?.id, 2);
  assert.equal(selectBulkDownload(links, "720p")?.id, 1);
  assert.equal(selectBulkDownload(links, "unspecified")?.id, 3);
  assert.equal(selectBulkDownload(links, "480p"), null);
});

test("bulk queue preserves all three selected episodes and reports missing qualities", () => {
  const base: Omit<DownloadLink, "id" | "url" | "quality" | "label" | "storageProvider"> = {
    mediaId: 5, seasonId: 2, episodeId: null, fileSize: null, isUploaded: false, objectKey: null, sizeBytes: null,
  };
  const episodes = [1, 2, 3].map((number) => ({
    id: number, episodeNumber: number, title: null,
    downloadLinks: number === 2 ? [] : [{ ...base, id: number, episodeId: number, url: `https://example.com/${number}.mp4`, quality: "1080p" as const, label: "1080p", storageProvider: "external" as const }],
  }));
  const queue = createBulkDownloadQueue(episodes, "1080p");
  assert.deepEqual(queue.map((item) => item.episodeNumber), [1, 2, 3]);
  assert.deepEqual(queue.map((item) => item.status), ["pending", "skipped", "pending"]);
  assert.equal(queue[0].link?.id, 1);
  assert.match(queue[1].message, /No safe, usable/);
  assert.equal(queue[2].link?.id, 3);
});

test("contact requests are validated and sanitized before server-side email", () => {
  const request = validateContactRequest({
    name: "  Ari\r\nSmith\u0000 ", type: "Anime", message: "  Please add season 2\r\nThanks\u0000  ",
  });
  assert.deepEqual(request, { name: "Ari Smith", type: "Anime", message: "Please add season 2\nThanks" });
  assert.throws(() => validateContactRequest({ name: "Ari", type: "<script>", message: "hello" }), ApiError);
  assert.throws(() => validateContactRequest({ name: "  ", type: "Movie", message: "hello" }), ApiError);
  assert.throws(() => validateContactRequest({ name: "Ari", type: "Movie", message: "x".repeat(2001) }), ApiError);
});

test("ids and byte formatting are validated", () => {
  assert.equal(positiveId("12"), 12);
  assert.throws(() => positiveId("1.5"), ApiError);
  assert.throws(() => positiveId(0), ApiError);
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
});
