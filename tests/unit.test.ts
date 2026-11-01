import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, getLinkHref, getLinkProvider, getQuality, safeExternalUrl } from "../src/lib/media-links";
import { positiveId, quality, ApiError } from "../src/lib/validation";

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

test("quality is explicit or inferred from legacy labels", () => {
  assert.equal(getQuality({ quality: null, label: "WEB-DL 1080p" }), "1080p");
  assert.equal(getQuality({ quality: "720p", label: "anything" }), "720p");
  assert.equal(quality("other"), "other");
  assert.throws(() => quality("4k"), ApiError);
});

test("ids and byte formatting are validated", () => {
  assert.equal(positiveId("12"), 12);
  assert.throws(() => positiveId("1.5"), ApiError);
  assert.throws(() => positiveId(0), ApiError);
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
});
