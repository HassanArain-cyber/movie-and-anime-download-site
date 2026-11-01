import assert from "node:assert/strict";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import pg from "pg";

const run = Date.now().toString(36);
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
const password = process.env.E2E_ADMIN_PASSWORD || "test-admin-password";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
let cookie = "";

async function api(path, { method = "GET", body, auth = true, redirect = "manual" } = {}) {
  const res = await fetch(base + path, {
    method, redirect,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { res, data };
}
function ok(result, status = 200) { assert.equal(result.res.status, status, `${result.res.url} -> ${result.res.status}: ${JSON.stringify(result.data)}`); return result.data; }

async function uploadFile({ kind, fileName, bytes, contentType, target }) {
  const init = ok(await api("/api/uploads", { method: "POST", body: { kind, fileName, sizeBytes: bytes.length, contentType, ...target } }), 201);
  for (const part of init.parts) {
    const start = (part.partNumber - 1) * init.partSizeBytes;
    const chunk = bytes.subarray(start, Math.min(start + init.partSizeBytes, bytes.length));
    const res = await fetch(part.url, { method: "PUT", body: chunk, headers: part.headers });
    assert.ok(res.ok, `part upload ${res.status}`);
  }
  return ok(await api(`/api/uploads/${init.id}/complete`, { method: "POST" }));
}

const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
const before = await pool.query("SELECT (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM download_links) AS links");

// Auth and legacy preservation
ok(await api("/api/health"));
assert.equal((await api("/api/uploads", { method: "POST", auth: false, body: {} })).res.status, 401);
assert.equal((await api("/api/auth/login", { method: "POST", auth: false, body: { password: "wrong" } })).res.status, 401);
ok(await api("/api/auth/login", { method: "POST", auth: false, body: { password } }));
const legacyMovie = ok(await api("/api/media?slug=legacy-movie"));
assert.equal(legacyMovie.posterUrl, "/uploads/images/legacy.jpg");
assert.equal(legacyMovie.downloadLinks[0].url, "/uploads/videos/legacy.mp4");
const legacyDownload = await fetch(`${base}/api/download?id=${legacyMovie.downloadLinks[0].id}`, { redirect: "manual" });
assert.equal(legacyDownload.status, 200);
assert.equal(await legacyDownload.text(), "legacy-video-bytes");
const range = await fetch(`${base}/api/download?id=${legacyMovie.downloadLinks[0].id}`, { headers: { Range: "bytes=0-5" } });
assert.equal(range.status, 206); assert.equal(await range.text(), "legacy");
assert.equal((await fetch(`${base}/api/download?url=/uploads/../../package.json`)).status, 404);

// Create movie with separate qualities and Telegram support
const movie = ok(await api("/api/media", { method: "POST", body: { type: "movie", title: `E2E Movie ${run}`, year: 2026 } }), 201);
const telegram = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "720p", label: "Telegram 720p", url: "https://t.me/example/720" } }), 201);
assert.equal(telegram.storageProvider, "telegram");
ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "1080p", label: "External 1080p", url: "https://example.com/1080.mp4" } }), 201);
assert.equal((await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, url: "javascript:alert(1)" } })).res.status, 400);

// Multipart R2 video (two parts with the test part size)
const videoBytes = Buffer.alloc(6 * 1024 * 1024, 7);
const video = await uploadFile({ kind: "video", fileName: "e2e-1080p.mp4", bytes: videoBytes, contentType: "video/mp4", target: { mediaId: movie.id, quality: "1080p" } });
assert.ok(video.url.startsWith("r2:///"));
const r2Link = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "1080p", label: "R2 1080p", r2UploadId: video.id } }), 201);
assert.equal(r2Link.storageProvider, "r2"); assert.equal(r2Link.sizeBytes, videoBytes.length);
const signed = await fetch(`${base}/api/download?id=${r2Link.id}`, { redirect: "manual" });
assert.equal(signed.status, 302);
const signedUrl = signed.headers.get("location"); assert.ok(signedUrl.includes("X-Amz-Signature"));
const downloaded = await fetch(signedUrl); assert.equal(downloaded.status, 200);
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), videoBytes);

// Poster image through private R2
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");
const image = await uploadFile({ kind: "image", fileName: "poster.png", bytes: png, contentType: "image/png", target: { mediaId: movie.id } });
ok(await api(`/api/media/${movie.id}`, { method: "PATCH", body: { posterUrl: image.imageUrl } }));
const imageRedirect = await fetch(`${base}${image.imageUrl}`, { redirect: "manual" });
assert.equal(imageRedirect.status, 302); assert.equal((await fetch(imageRedirect.headers.get("location"))).status, 200);

// Anime season, batch episodes, season archive, episode quality links
const anime = ok(await api("/api/media", { method: "POST", body: { type: "anime", title: `E2E Anime ${run}`, year: 2026 } }), 201);
const season = ok(await api("/api/seasons", { method: "POST", body: { mediaId: anime.id, seasonNumber: 1, name: "Complete Season" } }), 201);
const batch = ok(await api("/api/episodes/batch", { method: "POST", body: { seasonId: season.id, start: 1, count: 3, titlePrefix: "Episode", duration: "24m" } }), 201);
assert.equal(batch.episodes.length, 3);
assert.equal((await api("/api/episodes/batch", { method: "POST", body: { seasonId: season.id, start: 1, count: 2 } })).res.status, 409);
const archiveBytes = Buffer.from("PK-E2E-ARCHIVE");
const archive = await uploadFile({ kind: "archive", fileName: "season-1-1080p.zip", bytes: archiveBytes, contentType: "application/zip", target: { mediaId: anime.id, seasonId: season.id, quality: "1080p" } });
const archiveLink = ok(await api("/api/download-links", { method: "POST", body: { mediaId: anime.id, seasonId: season.id, quality: "1080p", label: "Complete season 1080p", r2UploadId: archive.id } }), 201);
assert.equal(archiveLink.seasonId, season.id); assert.equal(archiveLink.episodeId, null);
const ep1 = batch.episodes[0];
const epVideo = await uploadFile({ kind: "video", fileName: "S01E01-720p.mp4", bytes: Buffer.alloc(1024, 3), contentType: "video/mp4", target: { mediaId: anime.id, seasonId: season.id, episodeId: ep1.id, quality: "720p" } });
ok(await api("/api/download-links", { method: "POST", body: { mediaId: anime.id, seasonId: season.id, episodeId: ep1.id, quality: "720p", r2UploadId: epVideo.id } }), 201);
assert.equal((await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, seasonId: season.id, url: "https://example.com/x" } })).res.status, 400);
const full = ok(await api(`/api/media/${anime.id}`));
assert.equal(full.seasons[0].downloadLinks.length, 1);
assert.equal(full.seasons[0].episodes[0].downloadLinks[0].quality, "720p");

// Deleting a link must not delete the R2 object.
ok(await api(`/api/download-links/${r2Link.id}`, { method: "DELETE" }));
const stillThere = await fetch(signedUrl); assert.equal(stillThere.status, 200);

// Cancel an incomplete multipart upload.
const cancelled = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cancel.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
ok(await api(`/api/uploads/${cancelled.id}`, { method: "DELETE" }));
assert.equal((await api(`/api/uploads/${cancelled.id}/complete`, { method: "POST" })).res.status, 409);

// Browser admin flow: login, create anime season, batch episodes, external quality link.
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${base}/admin`);
await page.getByPlaceholder("Password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Admin Dashboard" }).waitFor();
await page.getByRole("button", { name: "+ Add media" }).click();
await page.getByLabel("Type").selectOption("anime");
await page.getByLabel("Title", { exact: true }).fill(`Browser Anime ${run}`);
await page.getByRole("button", { name: "Create & Continue" }).click();
await page.getByLabel("Season #").waitFor();
await page.getByLabel("Season #").fill("1");
await page.getByRole("button", { name: "+ Add season" }).click();
await page.getByText("Create a complete season").waitFor();
await page.getByLabel("Count").fill("2");
await page.getByRole("button", { name: "Create episodes" }).click();
await page.getByText("Episode 1", { exact: true }).waitFor();
await page.getByText("Episode 1", { exact: true }).click();
const episodeForm = page.getByRole("form", { name: "Download link form episode" });
await episodeForm.getByPlaceholder("https://t.me/…, https://…, tg://…, or magnet:…").fill("https://t.me/browser/1080");
await episodeForm.getByRole("button", { name: "Add link", exact: true }).click();
await page.getByText("Telegram", { exact: true }).waitFor();
// Upload a real file through the admin UI to the local S3-compatible mock.
await episodeForm.locator('input[type="file"]').setInputFiles({ name: "browser-episode-1080p.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 9) });
await page.getByText(/Uploaded and verified in R2/).waitFor();
await episodeForm.getByRole("button", { name: "Add link", exact: true }).click();
await page.getByText("Cloudflare R2", { exact: true }).waitFor();
await page.goto(`${base}/anime/browser-anime-${run}`);
await page.getByRole("heading", { name: `Browser Anime ${run}` }).waitFor();
await page.getByText("Episode 1", { exact: true }).click();
await page.locator('a[title="Cloudflare R2"]').waitFor();
assert.deepEqual(errors, []);
await browser.close();

// Existing records are still present; migrations are additive.
const after = await pool.query("SELECT (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM download_links) AS links");
assert.ok(Number(after.rows[0].media) >= Number(before.rows[0].media));
const legacyStill = await pool.query("SELECT url FROM download_links WHERE url='/uploads/videos/legacy.mp4'");
assert.equal(legacyStill.rowCount, 1);
await pool.end();
console.log("E2E passed: auth, legacy files/ranges, Telegram, R2 multipart video/image/archive, signed downloads, seasons, batch episodes, quality links, browser admin, object retention.");
