import assert from "node:assert/strict";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import pg from "pg";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const run = Date.now().toString(36);
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
const password = process.env.E2E_ADMIN_PASSWORD || "test-admin-password";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
let cookie = "";

async function api(path, { method = "GET", body, auth = true, redirect = "manual", headers = {} } = {}) {
  const res = await fetch(base + path, {
    method, redirect,
    headers: { "x-e2e-client-ip": "198.51.100.1", ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
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

// Title suggestions are case-insensitive, title-only, and include every media type.
const jujuFixtures = [
  { type: "movie", title: `Juju Movie ${run}`, slug: `juju-movie-${run}` },
  { type: "anime", title: `Jujutsu Kaisen ${run}`, slug: `jujutsu-kaisen-${run}` },
  { type: "series", title: `Juju Series ${run}`, slug: `juju-series-${run}` },
];
for (const fixture of jujuFixtures) {
  await pool.query("INSERT INTO media (type, title, slug) VALUES ($1, $2, $3)", [fixture.type, fixture.title, fixture.slug]);
}
const jujuSuggestions = ok(await api("/api/media?suggestions=1&q=JUJU"));
assert.deepEqual(new Set(jujuSuggestions.filter((item) => item.title.endsWith(run)).map((item) => item.type)), new Set(["movie", "anime", "series"]));
assert.deepEqual(ok(await api("/api/media?suggestions=1&q=Existing")), [], "suggestions must match titles rather than descriptions");

// Contact requests are saved directly to PostgreSQL; all management routes are admin-only.
ok(await api("/api/health"));
assert.equal((await api("/api/contact/requests", { auth: false })).res.status, 401);
assert.equal((await api("/api/contact/requests/1", { method: "DELETE", auth: false })).res.status, 401);
const contactIp = `198.51.100.${(Date.now() % 180) + 20}`;
const contactPayload = { name: "  Ari\r\nSmith  ", type: "Anime", message: "Please add season 2\r\nThanks" };
const sentContact = await api("/api/contact", { method: "POST", auth: false, body: contactPayload, headers: { "x-e2e-client-ip": contactIp } });
assert.equal(sentContact.res.status, 201, JSON.stringify(sentContact.data));
assert.deepEqual(sentContact.data, { success: true, id: sentContact.data.id, notificationSent: true });
assert.equal(JSON.stringify(sentContact.data).includes("test-resend-key"), false, "email credentials must not be returned to the browser");
const mockResendPort = Number(process.env.MOCK_RESEND_PORT || 9001);
const sentEmail = await (await fetch(`http://127.0.0.1:${mockResendPort}/last`)).json();
assert.deepEqual(sentEmail.to, ["vault-test@example.com"]);
assert.equal(sentEmail.from, "Vault Test <requests@example.com>");
assert.match(sentEmail.text, /Name: Ari Smith/);
assert.ok(sentEmail.text.includes("Please add season 2\nThanks"));
const savedContact = await pool.query("SELECT name, request_type, message, created_at FROM contact_requests WHERE id=$1", [sentContact.data.id]);
assert.equal(savedContact.rowCount, 1);
assert.deepEqual({ name: savedContact.rows[0].name, requestType: savedContact.rows[0].request_type, message: savedContact.rows[0].message }, {
  name: "Ari Smith", requestType: "Anime", message: "Please add season 2\nThanks",
});
assert.ok(savedContact.rows[0].created_at instanceof Date, "submission timestamp is created by PostgreSQL");
const badContactType = await api("/api/contact", { method: "POST", auth: false, body: { name: "Ari", type: "<script>", message: "Hello" }, headers: { "x-e2e-client-ip": `${contactIp.split(".").slice(0, 3).join(".")}.2` } });
assert.equal(badContactType.res.status, 400);
const honeypotContact = await api("/api/contact", { method: "POST", auth: false, body: { name: "Bot", type: "Other", message: "spam", company: "bot.example" }, headers: { "x-e2e-client-ip": `${contactIp.split(".").slice(0, 3).join(".")}.3` } });
assert.equal(honeypotContact.res.status, 400);
const crossSiteContact = await api("/api/contact", { method: "POST", auth: false, body: contactPayload, headers: { Origin: "https://evil.example", "x-e2e-client-ip": `${contactIp.split(".").slice(0, 3).join(".")}.4` } });
assert.equal(crossSiteContact.res.status, 403);
const backedUpTable = "contact_requests_test_backup";
await pool.query(`ALTER TABLE contact_requests RENAME TO ${backedUpTable}`);
const failedSave = await api("/api/contact", { method: "POST", auth: false, body: contactPayload, headers: { "x-e2e-client-ip": `${contactIp.split(".").slice(0, 3).join(".")}.5` } });
assert.equal(failedSave.res.status, 503);
assert.match(failedSave.data.error, /couldn’t save your request/i);
await pool.query(`ALTER TABLE ${backedUpTable} RENAME TO contact_requests`);
const failedEmailIp = `${contactIp.split(".").slice(0, 3).join(".")}.7`;
const failedEmail = await api("/api/contact", { method: "POST", auth: false, body: { name: "Saved First", type: "Movie", message: "[MOCK_FAIL]" }, headers: { "x-e2e-client-ip": failedEmailIp } });
assert.equal(failedEmail.res.status, 201, JSON.stringify(failedEmail.data));
assert.deepEqual(failedEmail.data, { success: true, id: failedEmail.data.id, notificationSent: false });
const savedDespiteEmailFailure = await pool.query("SELECT name, message FROM contact_requests WHERE id=$1", [failedEmail.data.id]);
assert.deepEqual(savedDespiteEmailFailure.rows[0], { name: "Saved First", message: "[MOCK_FAIL]" }, "email rejection must not lose the saved database request");
const limitedContactIp = `${contactIp.split(".").slice(0, 3).join(".")}.6`;
for (let attempt = 0; attempt < 5; attempt++) {
  const accepted = await api("/api/contact", { method: "POST", auth: false, body: { name: "Ari", type: "Other", message: `Rate test ${attempt}` }, headers: { "x-e2e-client-ip": limitedContactIp } });
  assert.equal(accepted.res.status, 201);
}
const rateLimitedContact = await api("/api/contact", { method: "POST", auth: false, body: contactPayload, headers: { "x-e2e-client-ip": limitedContactIp } });
assert.equal(rateLimitedContact.res.status, 429);
assert.ok(Number(rateLimitedContact.res.headers.get("retry-after")) >= 1);
assert.equal(ok(await api("/api/site-settings")).wallpaperUrl, null);
assert.equal((await api("/api/site-settings", { method: "PUT", auth: false, body: { wallpaperUrl: "https://example.com/wallpaper.jpg" } })).res.status, 401);
assert.equal((await api("/api/site-settings", { method: "DELETE", auth: false })).res.status, 401);
assert.equal((await api("/api/uploads", { method: "POST", auth: false, body: {} })).res.status, 401);
assert.equal((await api("/api/auth/login", { method: "POST", auth: false, body: { password: "wrong" } })).res.status, 401);
ok(await api("/api/auth/login", { method: "POST", auth: false, body: { password } }));
ok(await api("/api/auth/login", { method: "POST", auth: false, body: { password } }));

// Login hardening: origin checks, JSON content type/size, and DB-backed limits.
assert.equal((await api("/api/auth/login", { method: "POST", auth: false, body: { password }, headers: { Origin: "https://evil.example" } })).res.status, 403);
assert.equal((await api("/api/auth/login", { method: "POST", auth: false, body: { password }, headers: { "Sec-Fetch-Site": "cross-site" } })).res.status, 403);
const wrongType = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "text/plain", "x-e2e-client-ip": "198.51.100.2" }, body: JSON.stringify({ password }) });
assert.equal(wrongType.status, 415);
const tooLarge = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "x-e2e-client-ip": "198.51.100.3" }, body: JSON.stringify({ password: "x".repeat(20000) }) });
assert.equal(tooLarge.status, 413);
const limitedIp = "198.51.100.10";
for (let i = 0; i < 5; i++) {
  const attempt = await api("/api/auth/login", { method: "POST", auth: false, body: { password: "wrong" }, headers: { "x-e2e-client-ip": limitedIp } });
  assert.equal(attempt.res.status, 401);
  assert.equal(attempt.res.headers.get("cache-control"), "no-store");
}
const blocked = await api("/api/auth/login", { method: "POST", auth: false, body: { password }, headers: { "x-e2e-client-ip": limitedIp, "x-forwarded-for": "203.0.113.99" } });
assert.equal(blocked.res.status, 429);
assert.ok(Number(blocked.res.headers.get("retry-after")) >= 1);
assert.equal(blocked.res.headers.get("cache-control"), "no-store");
ok(await api("/api/auth/login", { method: "POST", auth: false, body: { password }, headers: { "x-e2e-client-ip": "198.51.100.11" } }));
const concurrentIp = "198.51.100.12";
const concurrent = await Promise.all(Array.from({ length: 8 }, () => api("/api/auth/login", { method: "POST", auth: false, body: { password: "wrong" }, headers: { "x-e2e-client-ip": concurrentIp } })));
assert.equal(concurrent.filter((result) => result.res.status === 401).length, 5);
assert.equal(concurrent.filter((result) => result.res.status === 429).length, 3);
const malformedIp = "198.51.100.13";
for (let i = 0; i < 5; i++) {
  const malformed = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "x-e2e-client-ip": malformedIp }, body: "{" });
  assert.equal(malformed.status, 400);
}
assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "x-e2e-client-ip": malformedIp }, body: JSON.stringify({ password }) })).status, 429);
await new Promise((resolve) => setTimeout(resolve, Number(process.env.ADMIN_LOGIN_WINDOW_SECONDS || 5) * 1000 + 300));
ok(await api("/api/auth/login", { method: "POST", auth: false, body: { password }, headers: { "x-e2e-client-ip": limitedIp } }));
const storedKeys = await pool.query("SELECT key FROM auth_rate_limits");
assert.ok(storedKeys.rows.every((row) => /^[0-9a-f]{64}$/.test(row.key) && !row.key.includes("198.51.100")));
await pool.query("ALTER TABLE auth_rate_limits RENAME TO auth_rate_limits_outage");
try {
  assert.equal((await api("/api/auth/login", { method: "POST", auth: false, body: { password }, headers: { "x-e2e-client-ip": "198.51.100.14" } })).res.status, 503);
} finally {
  await pool.query("ALTER TABLE auth_rate_limits_outage RENAME TO auth_rate_limits");
}
assert.equal((await api("/api/media", { method: "POST", body: { type: "movie", title: "CSRF" }, headers: { Origin: "https://evil.example" } })).res.status, 403);
assert.equal((await api("/api/auth/logout", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } })).res.status, 403);
const securityHeaders = await fetch(`${base}/`);
assert.equal(securityHeaders.headers.get("x-content-type-options"), "nosniff");
assert.equal(securityHeaders.headers.get("x-frame-options"), "DENY");
const legacyMovie = ok(await api("/api/media?slug=legacy-movie"));
assert.equal(legacyMovie.posterUrl, "/uploads/images/legacy.jpg");
const primaryLegacy = legacyMovie.downloadLinks.find((link) => link.url === "/uploads/videos/legacy.mp4");
assert.ok(primaryLegacy, "primary legacy link was seeded");
assert.equal(primaryLegacy.url, "/uploads/videos/legacy.mp4");
const legacyDownload = await fetch(`${base}/api/download?id=${primaryLegacy.id}`, { redirect: "manual" });
assert.equal(legacyDownload.status, 200);
assert.equal(await legacyDownload.text(), "legacy-video-bytes");
const range = await fetch(`${base}/api/download?id=${primaryLegacy.id}`, { headers: { Range: "bytes=0-5" } });
assert.equal(range.status, 206); assert.equal(await range.text(), "legacy");
assert.equal((await fetch(`${base}/api/download?url=/uploads/../../package.json`)).status, 404);
assert.equal((await fetch(`${base}/api/download?url=/uploads/../../package.json`)).status, 404);
const encodedLegacy = legacyMovie.downloadLinks.find((link) => link.url === "/uploads/videos/legacy%20space.mp4");
assert.ok(encodedLegacy, "encoded legacy link was seeded");
const encodedDownload = await fetch(`${base}/api/download?id=${encodedLegacy.id}`);
assert.equal(encodedDownload.status, 200); assert.equal(await encodedDownload.text(), "encoded-legacy");
const emptyLegacy = legacyMovie.downloadLinks.find((link) => link.url === "/uploads/videos/empty.mp4");
const emptyDownload = await fetch(`${base}/api/download?id=${emptyLegacy.id}`);
assert.equal(emptyDownload.status, 200); assert.equal((await emptyDownload.arrayBuffer()).byteLength, 0);
const legacyHead = await fetch(`${base}/api/download?id=${primaryLegacy.id}`, { method: "HEAD" });
assert.equal(legacyHead.status, 200); assert.equal(legacyHead.headers.get("content-length"), "18");
const optimizedLegacy = await fetch(`${base}/_next/image?url=${encodeURIComponent("/uploads/images/legacy.jpg")}&w=64&q=75`);
assert.equal(optimizedLegacy.status, 200, "legacy local poster optimization must keep working");
const optimizedRemote = await fetch(`${base}/_next/image?url=${encodeURIComponent("https://example.com/poster.jpg")}&w=64&q=75`);
assert.equal(optimizedRemote.status, 400, "server-side optimizer must not fetch arbitrary remote URLs");
const optimizedPrivate = await fetch(`${base}/_next/image?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}&w=64&q=75`);
assert.equal(optimizedPrivate.status, 400);
for (const path of ["/uploads/%2e%2e/package.json", "/uploads/%252e%252e/package.json"]) {
  const traversal = await fetch(`${base}/_next/image?url=${encodeURIComponent(path)}&w=64&q=75`);
  assert.ok(traversal.status === 400 || traversal.status === 404, `optimizer must not escape /uploads: ${path}`);
}

// Create movie with separate qualities and Telegram support
const movie = ok(await api("/api/media", { method: "POST", body: { type: "movie", title: `E2E Movie ${run}`, year: 2026 } }), 201);
const telegram = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "720p", label: "Telegram 720p", url: "https://t.me/example/720" } }), 201);
assert.equal(telegram.storageProvider, "telegram");
const lowQuality = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "480p", label: "480p compact", fileSize: "400 MB", url: "https://example.com/480.mp4" } }), 201);
assert.equal(lowQuality.quality, "480p"); assert.equal(lowQuality.fileSize, "400 MB");
const fullHD = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "1080p", label: "External 1080p", url: "https://example.com/1080.mp4" } }), 201);
assert.equal(fullHD.quality, "1080p");
const fourK = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "4K", label: "4K WEB-DL", fileSize: "2 GB", url: "https://example.com/4k.mp4" } }), 201);
assert.equal(fourK.quality, "2160p"); assert.equal(fourK.label, "4K WEB-DL");
const fourKVideo = await uploadFile({ kind: "video", fileName: "e2e-4k.mp4", bytes: Buffer.alloc(1024, 8), contentType: "video/mp4", target: { mediaId: movie.id, quality: "4K" } });
const fourKR2Link = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "4K", label: "Private 4K", r2UploadId: fourKVideo.id } }), 201);
assert.equal(fourKR2Link.quality, "2160p"); assert.equal(fourKR2Link.storageProvider, "r2");
const movieDetails = ok(await api(`/api/media/${movie.id}`));
assert.deepEqual(new Set(movieDetails.downloadLinks.map((link) => link.quality)), new Set(["480p", "720p", "1080p", "2160p"]));
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
const headRedirect = await fetch(`${base}/api/download?id=${r2Link.id}`, { method: "HEAD", redirect: "manual" });
assert.equal(headRedirect.status, 302);
const headSigned = headRedirect.headers.get("location");
assert.equal((await fetch(headSigned, { method: "HEAD" })).status, 200);
assert.equal((await fetch(signedUrl, { method: "HEAD" })).status, 403, "GET-signed URL must not authorize HEAD");
const objectUrl = new URL(signedUrl);
assert.equal((await fetch(`${objectUrl.origin}${objectUrl.pathname}`)).status, 403, "unsigned object access must fail");
const tampered = new URL(signedUrl); tampered.searchParams.set("X-Amz-Signature", "0".repeat(64));
assert.equal((await fetch(tampered)).status, 403);
const shortLived = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
const expiringUrl = await getSignedUrl(shortLived, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: video.objectKey }), { expiresIn: 1 });
assert.equal((await fetch(expiringUrl)).status, 200);
await new Promise((resolve) => setTimeout(resolve, 1200));
assert.equal((await fetch(expiringUrl)).status, 403, "expired signed URL must fail");
assert.equal((await api(`/api/image?upload=${video.id}`)).res.status, 404, "video must not be exposed through image endpoint");

const resumeTarget = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "resume-target.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
assert.deepEqual(resumeTarget.target, { mediaId: movie.id, seasonId: null, episodeId: null, quality: "720p" });
const refreshedTarget = ok(await api(`/api/uploads/${resumeTarget.id}`));
assert.deepEqual(refreshedTarget.target, resumeTarget.target);
ok(await api(`/api/uploads/${resumeTarget.id}`, { method: "DELETE" }));

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
const ep720 = ok(await api("/api/download-links", { method: "POST", body: { mediaId: anime.id, seasonId: season.id, episodeId: ep1.id, quality: "720p", r2UploadId: epVideo.id } }), 201);
const ep1080 = ok(await api("/api/download-links", { method: "POST", body: { mediaId: anime.id, seasonId: season.id, episodeId: ep1.id, quality: "1080p", label: "External 1080p", url: "https://example.com/episode-1080.mp4" } }), 201);
assert.equal(ep720.quality, "720p"); assert.equal(ep1080.quality, "1080p");
assert.equal((await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, seasonId: season.id, url: "https://example.com/x" } })).res.status, 400);
assert.equal((await api(`/api/media/${anime.id}`, { method: "PATCH", body: { type: "movie" } })).res.status, 409, "anime with seasons must not be hidden by a type change");
const full = ok(await api(`/api/media/${anime.id}`));
assert.equal(full.seasons[0].downloadLinks.length, 1);
assert.deepEqual(new Set(full.seasons[0].episodes[0].downloadLinks.map((link) => link.quality)), new Set(["720p", "1080p"]));

// Deleting a link must not delete the R2 object.
ok(await api(`/api/download-links/${r2Link.id}`, { method: "DELETE" }));
const stillThere = await fetch(signedUrl); assert.equal(stillThere.status, 200);

// Cancel an incomplete multipart upload.
const cancelled = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cancel.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
ok(await api(`/api/uploads/${cancelled.id}`, { method: "DELETE" }));
assert.equal((await api(`/api/uploads/${cancelled.id}/complete`, { method: "POST" })).res.status, 409);

// Upload session expiry, bucket binding, and transition locks.
const expired = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "expired.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET expires_at = now() - interval '1 second' WHERE id=$1", [expired.id]);
assert.equal((await api(`/api/uploads/${expired.id}`)).res.status, 410);
assert.equal((await api(`/api/uploads/${expired.id}/complete`, { method: "POST" })).res.status, 410);
ok(await api(`/api/uploads/${expired.id}`, { method: "DELETE" }));
const wrongBucket = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "wrong-bucket.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET bucket='other-bucket' WHERE id=$1", [wrongBucket.id]);
assert.equal((await api(`/api/uploads/${wrongBucket.id}`)).res.status, 409);
assert.equal((await api(`/api/uploads/${wrongBucket.id}/complete`, { method: "POST" })).res.status, 409);
assert.equal((await api(`/api/uploads/${wrongBucket.id}`, { method: "DELETE" })).res.status, 409);
await pool.query("UPDATE r2_uploads SET bucket=$1 WHERE id=$2", [process.env.R2_BUCKET_NAME, wrongBucket.id]);
ok(await api(`/api/uploads/${wrongBucket.id}`, { method: "DELETE" }));
const locked = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "locked.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET status='completing', operation_expires_at=now() + interval '10 minutes' WHERE id=$1", [locked.id]);
assert.equal((await api(`/api/uploads/${locked.id}`, { method: "DELETE" })).res.status, 409);
await pool.query("UPDATE r2_uploads SET status='aborting', operation_expires_at=now() + interval '10 minutes' WHERE id=$1", [locked.id]);
assert.equal((await api(`/api/uploads/${locked.id}/complete`, { method: "POST" })).res.status, 409);
await pool.query("UPDATE r2_uploads SET status='pending', operation_expires_at=NULL, operation_id=NULL WHERE id=$1", [locked.id]);
ok(await api(`/api/uploads/${locked.id}`, { method: "DELETE" }));
// Crashed transition leases are recoverable, and cleanup only touches the configured bucket.
const staleCompleting = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "stale-completing.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET status='completing', operation_expires_at=now() - interval '1 minute' WHERE id=$1", [staleCompleting.id]);
const staleComplete = await api(`/api/uploads/${staleCompleting.id}/complete`, { method: "POST" });
assert.equal(staleComplete.res.status, 400, "stale completing with no parts must fail verification, not stay locked");
assert.equal((await api(`/api/uploads/${staleCompleting.id}`, { method: "DELETE" })).res.status, 200);
const cleanupPending = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cleanup-pending.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET expires_at=now() - interval '1 second' WHERE id=$1", [cleanupPending.id]);
const cleanupFailed = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cleanup-failed.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET status='failed', expires_at=now() - interval '1 second' WHERE id=$1", [cleanupFailed.id]);
const cleanupActiveLease = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cleanup-active-lease.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET status='completing', operation_expires_at=now() + interval '10 minutes' WHERE id=$1", [cleanupActiveLease.id]);
const cleanupRecovered = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cleanup-recovered.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
for (const part of cleanupRecovered.parts) {
  const res = await fetch(part.url, { method: "PUT", body: Buffer.alloc(part.partNumber === cleanupRecovered.parts.length ? cleanupRecovered.sizeBytes - (part.partNumber - 1) * cleanupRecovered.partSizeBytes : cleanupRecovered.partSizeBytes, 4) });
  assert.ok(res.ok);
}
ok(await api(`/api/uploads/${cleanupRecovered.id}/complete`, { method: "POST" }));
await pool.query("UPDATE r2_uploads SET status='completing', operation_expires_at=now() - interval '1 minute' WHERE id=$1", [cleanupRecovered.id]);
const cleanupOtherBucket = ok(await api("/api/uploads", { method: "POST", body: { kind: "video", fileName: "cleanup-other.mp4", sizeBytes: 1024, contentType: "video/mp4", mediaId: movie.id, quality: "720p" } }), 201);
await pool.query("UPDATE r2_uploads SET bucket='other-bucket', expires_at=now() - interval '1 second' WHERE id=$1", [cleanupOtherBucket.id]);
const cleanupRun = await execFileAsync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/r2-cleanup.ts"], { env: process.env });
assert.match(cleanupRun.stdout, /2 expired incomplete upload\(s\) aborted, 1 completed upload\(s\) recovered/);
assert.equal((await pool.query("SELECT status FROM r2_uploads WHERE id=$1", [cleanupPending.id])).rows[0].status, "aborted");
assert.equal((await pool.query("SELECT status FROM r2_uploads WHERE id=$1", [cleanupFailed.id])).rows[0].status, "aborted");
assert.equal((await pool.query("SELECT status FROM r2_uploads WHERE id=$1", [cleanupActiveLease.id])).rows[0].status, "completing");
await pool.query("UPDATE r2_uploads SET status='pending', operation_expires_at=NULL, operation_id=NULL WHERE id=$1", [cleanupActiveLease.id]);
ok(await api(`/api/uploads/${cleanupActiveLease.id}`, { method: "DELETE" }));
assert.equal((await pool.query("SELECT status FROM r2_uploads WHERE id=$1", [cleanupRecovered.id])).rows[0].status, "completed");
assert.equal((await pool.query("SELECT status FROM r2_uploads WHERE id=$1", [cleanupOtherBucket.id])).rows[0].status, "pending");
await pool.query("UPDATE r2_uploads SET bucket=$1 WHERE id=$2", [process.env.R2_BUCKET_NAME, cleanupOtherBucket.id]);
ok(await api(`/api/uploads/${cleanupOtherBucket.id}`, { method: "DELETE" }));
await pool.query("UPDATE r2_uploads SET bucket='other-bucket' WHERE id=$1", [video.id]);
assert.equal((await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "1080p", r2UploadId: video.id } })).res.status, 409);
assert.equal((await fetch(`${base}/api/download?id=${r2Link.id}`, { redirect: "manual" })).status, 404);
await pool.query("UPDATE r2_uploads SET bucket=$1 WHERE id=$2", [process.env.R2_BUCKET_NAME, video.id]);

// Direct download URLs must already be recorded; no open redirect.
assert.equal((await fetch(`${base}/api/download?url=${encodeURIComponent("https://evil.example/phish")}`, { redirect: "manual" })).status, 404);
const externalLink = ok(await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, url: "https://example.com/recorded.mp4" } }), 201);
const externalRedirect = await fetch(`${base}/api/download?id=${externalLink.id}`, { redirect: "manual" });
assert.equal(externalRedirect.status, 302); assert.equal(externalRedirect.headers.get("location"), "https://example.com/recorded.mp4");
assert.equal((await fetch(`${base}/api/download?id=${externalLink.id}&url=${encodeURIComponent("https://example.com/recorded.mp4")}`, { redirect: "manual" })).status, 400);

// Poster/thumbnail and category input validation.
assert.equal((await api("/api/media", { method: "POST", body: { type: "movie", title: "Unsafe poster", posterUrl: "javascript:alert(1)" } })).res.status, 400);
assert.equal((await api("/api/media", { method: "POST", body: { type: "movie", title: "Private poster", posterUrl: "http://169.254.169.254/latest" } })).res.status, 400);
assert.equal((await api(`/api/media/${movie.id}`, { method: "PATCH", body: { thumbnailUrl: "http://127.0.0.1/x" } })).res.status, 400);
assert.equal((await api("/api/categories", { method: "POST", body: { name: { bad: true } } })).res.status, 400);
assert.equal((await api("/api/categories/not-a-number", { method: "PATCH", body: { name: "Valid" } })).res.status, 400);
assert.equal((await api("/api/uploads", { method: "POST", auth: false, body: {} })).res.status, 401);
assert.equal((await api(`/api/uploads/${video.id}`, { auth: false })).res.status, 401);
assert.equal((await api(`/api/uploads/${video.id}`, { method: "DELETE", auth: false })).res.status, 401);
assert.equal((await api(`/api/uploads/${video.id}/complete`, { method: "POST", auth: false })).res.status, 401);

// Browser admin flow: login, create anime season, batch episodes, external quality link.
if (process.platform === "linux") {
  const { inflate, setupLambdaEnvironment } = await import("@sparticuz/chromium");
  const bin = fileURLToPath(new URL("../node_modules/@sparticuz/chromium/bin/al2023.tar.br", import.meta.url));
  await inflate(bin);
  setupLambdaEnvironment(path.join(os.tmpdir(), "al2023", "lib"));
}
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.1" } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`${base}/`);
assert.equal(await page.getByRole("combobox", { name: "Filter by tag" }).count(), 1, "tags should be available through a dropdown instead of a permanent list");
const tagDropdown = page.getByRole("combobox", { name: "Filter by tag" });
await tagDropdown.selectOption("legacy");
await page.waitForURL((url) => url.searchParams.get("category") === "legacy");
await page.locator(".grid").getByText("Legacy Movie", { exact: true }).waitFor();
assert.equal(await page.locator(".grid").getByText("Legacy Anime", { exact: true }).count(), 0, "selected tag should filter out uncategorized titles");
await tagDropdown.selectOption("");
await page.waitForURL((url) => !url.searchParams.has("category"));
await page.locator(".grid").getByText("Legacy Anime", { exact: true }).waitFor();

const searchBox = page.getByRole("combobox", { name: "Search movies, anime, and series" });
const suggestions = page.locator("#search-suggestions");
await searchBox.fill("NoSuchVaultTitle");
await suggestions.getByText(/No matching titles found/).waitFor();
await searchBox.fill("");
await searchBox.pressSequentially("Juju", { delay: 35 });
await suggestions.getByText(`Juju Movie ${run}`, { exact: true }).waitFor();
await suggestions.getByText(`Jujutsu Kaisen ${run}`, { exact: true }).waitFor();
await suggestions.getByText(`Juju Series ${run}`, { exact: true }).waitFor();
assert.equal(new URL(page.url()).searchParams.has("q"), false, "suggestions should appear before submitting the search");
await suggestions.getByRole("link", { name: new RegExp(`Jujutsu Kaisen ${run}.*Anime`) }).click();
await page.waitForURL((url) => url.pathname === `/anime/jujutsu-kaisen-${run}`);
await page.getByRole("heading", { name: `Jujutsu Kaisen ${run}` }).waitFor();

await searchBox.fill("Legacy");
await searchBox.press("Enter");
await page.waitForURL((url) => url.pathname === "/" && url.searchParams.get("q") === "Legacy");
await page.getByRole("heading", { name: /Search results for/ }).waitFor();
await page.goto(`${base}/admin`);
await page.getByRole("button", { name: "Request" }).click();
await page.getByRole("dialog", { name: "Send a request" }).waitFor();
const desktopModalLayout = await page.getByRole("dialog").evaluate((dialog) => {
  const rect = dialog.getBoundingClientRect();
  const backdrop = dialog.parentElement;
  const backdropRect = backdrop.getBoundingClientRect();
  return { centerX: rect.left + rect.width / 2, viewportCenter: window.innerWidth / 2, backdropTop: backdropRect.top, backdropHeight: backdropRect.height, zIndex: getComputedStyle(backdrop).zIndex, portaledToBody: backdrop.parentElement === document.body };
});
assert.ok(Math.abs(desktopModalLayout.centerX - desktopModalLayout.viewportCenter) < 1, "desktop modal should be centered");
assert.equal(desktopModalLayout.backdropTop, 0);
assert.equal(desktopModalLayout.backdropHeight, 900);
assert.equal(desktopModalLayout.zIndex, "1000");
assert.equal(desktopModalLayout.portaledToBody, true, "modal must escape the sticky/backdrop-filter navbar stacking context");
await page.setViewportSize({ width: 390, height: 430 });
const mobileModalLayout = await page.getByRole("dialog").evaluate((dialog) => {
  const rect = dialog.getBoundingClientRect();
  return { x: rect.left, right: rect.right, centerX: rect.left + rect.width / 2, viewportCenter: window.innerWidth / 2, scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight, bodyOverflow: document.body.style.overflow };
});
assert.ok(mobileModalLayout.x >= 0 && mobileModalLayout.right <= 390, "mobile dialog should fit viewport width");
assert.ok(Math.abs(mobileModalLayout.centerX - mobileModalLayout.viewportCenter) < 1, "mobile modal should be centered");
assert.ok(mobileModalLayout.scrollHeight > mobileModalLayout.clientHeight, "tall mobile dialog should remain internally scrollable");
assert.equal(mobileModalLayout.bodyOverflow, "hidden", "background page scrolling should be locked while the modal is open");
await page.keyboard.press("Escape");
await page.getByRole("dialog").waitFor({ state: "detached" });
assert.equal(await page.evaluate(() => document.body.style.overflow), "", "background scroll should restore after closing");
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: "Request" }).click();
await page.getByRole("textbox", { name: "Name" }).fill("E2E request sender");
await page.getByLabel("Request Type").selectOption("Episode");
await page.getByLabel("Message").fill("Please add episode 4");
const requestPopups = [];
page.on("popup", (popup) => requestPopups.push(popup));
const failContactUi = (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "We couldn’t save your request right now. Please try again later." }) });
await page.route("**/api/contact", failContactUi);
await page.getByRole("button", { name: "Submit" }).click();
await page.getByRole("alert").getByText(/couldn’t save your request/i).waitFor();
assert.equal(await page.getByRole("status").count(), 0, "a failed send must not show success");
await page.unroute("**/api/contact", failContactUi);
const failEmailUi = (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, id: 999, notificationSent: false }) });
await page.route("**/api/contact", failEmailUi);
await page.getByRole("button", { name: "Submit" }).click();
await page.getByRole("status").getByText(/request was saved, but the email notification could not be sent/i).waitFor();
await page.unroute("**/api/contact", failEmailUi);
await page.getByRole("textbox", { name: "Name" }).fill("E2E request sender");
await page.getByLabel("Request Type").selectOption("Episode");
await page.getByLabel("Message").fill("Please add episode 4");
await page.getByRole("button", { name: "Submit" }).click();
await page.getByText("Your request has been saved and the site admin has been notified. Thank you!").waitFor();
assert.equal(requestPopups.length, 0, "submitting must not open Gmail, Telegram, or another app");
assert.equal(await page.getByRole("link", { name: /Continue in (Telegram|Gmail)/ }).count(), 0);
await page.getByRole("button", { name: "Close request form" }).click();
await page.getByPlaceholder("Password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Admin Dashboard" }).waitFor();
await page.getByRole("button", { name: "requests", exact: true }).click();
await page.getByRole("heading", { name: "Submitted requests" }).waitFor();
await page.getByText("Ari Smith", { exact: true }).waitFor();
await page.getByText("E2E request sender", { exact: true }).waitFor();
page.on("dialog", (dialog) => void dialog.accept());
await page.getByRole("button", { name: "Delete request from E2E request sender" }).click();
await page.getByRole("status").getByText("Request deleted.").waitFor();
await page.getByText("E2E request sender", { exact: true }).waitFor({ state: "detached" });
const remainingRequests = ok(await api("/api/contact/requests"));
assert.ok(remainingRequests.some((request) => request.id === sentContact.data.id), "deleting one request must preserve other submitted requests");
// A settings endpoint failure must not hide a working image gallery or falsely
// report that R2 is unconfigured.
const failWallpaperRead = async (route) => {
  if (route.request().method() === "GET") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server error. Please try again." }) });
  else await route.continue();
};
await page.route("**/api/site-settings", failWallpaperRead);
await page.getByRole("button", { name: "Appearance" }).click();
await page.getByText(/Could not load the saved wallpaper/).waitFor();
await page.getByText("Legacy Movie · poster", { exact: true }).waitFor();
assert.equal(await page.getByText(/Required R2 environment variables are missing/).count(), 0, "a settings failure must not be mislabeled as missing R2 configuration");
await page.unroute("**/api/site-settings", failWallpaperRead);
await page.getByRole("button", { name: "media", exact: true }).click();
// Wallpaper uploads use the existing private-R2 image flow; the saved setting
// persists, supports the media gallery, and can be removed without deleting R2.
await page.getByRole("button", { name: "Appearance" }).click();
await page.locator('input[type="file"]').setInputFiles({ name: "wallpaper.png", mimeType: "image/png", buffer: png });
await page.getByText("Upload complete. Preview the image, then apply it to the site.").waitFor();
await page.getByRole("button", { name: "Apply wallpaper" }).click();
await page.getByText("Wallpaper applied and saved.").waitFor();
let wallpaperSettings = ok(await api("/api/site-settings"));
assert.match(wallpaperSettings.wallpaperUrl, /^\/api\/image\?upload=/);
const privateWallpaper = await fetch(`${base}${wallpaperSettings.wallpaperUrl}`, { redirect: "manual" });
assert.equal(privateWallpaper.status, 302, "wallpaper images are served through the private R2 signing route");
await page.goto(`${base}/`);
await page.locator('[data-testid="site-wallpaper"]').waitFor();
assert.ok(await page.locator('[data-testid="site-wallpaper"] img').getAttribute("src"));
await page.setViewportSize({ width: 390, height: 844 });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "wallpaper must not cause mobile overflow");
await page.goto(`${base}/admin`);
await page.getByRole("heading", { name: "Admin Dashboard" }).waitFor();
await page.getByRole("button", { name: "Appearance" }).click();
await page.getByText("Legacy Movie · poster", { exact: true }).click();
await page.getByRole("button", { name: "Replace wallpaper" }).click();
await page.getByText("Wallpaper applied and saved.").waitFor();
wallpaperSettings = ok(await api("/api/site-settings"));
assert.equal(wallpaperSettings.wallpaperUrl, "/uploads/images/legacy.jpg");
await page.getByRole("button", { name: "Remove wallpaper" }).click();
await page.getByText("Wallpaper removed. The private R2 image itself was retained.").waitFor();
assert.equal(ok(await api("/api/site-settings")).wallpaperUrl, null);
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: "media", exact: true }).click();
await page.getByRole("button", { name: "+ Add media" }).click();
await page.getByLabel("Type").selectOption("anime");
await page.getByLabel("Title", { exact: true }).fill(`Browser Anime ${run}`);
await page.getByRole("button", { name: "Create & Continue" }).click();
await page.getByLabel("Season #").waitFor();
await page.getByLabel("Season #").fill("1");
await page.getByRole("button", { name: "+ Add season" }).click();
await page.getByText("Create a complete season").waitFor();
await page.getByLabel("Count").fill("3");
await page.getByRole("button", { name: "Create episodes" }).click();
await page.getByText("Episode 1", { exact: true }).waitFor();
// A single batch may contain multiple qualities for the same episode.
await page.locator('input[type="file"][multiple]').setInputFiles([
  { name: "S01E01-720p.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 4) },
  { name: "S01E01-1080p.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 5) },
]);
await page.getByText("S01E01-720p.mp4").waitFor();
await page.getByText("S01E01-720p.mp4").locator("..").locator("select").selectOption("720p");
await page.getByRole("button", { name: "Upload / retry batch" }).click();
await page.getByText("2 files uploaded and attached. Failed rows can be retried without re-uploading completed files.").waitFor({ timeout: 60000 });
await page.getByText("Episode 1", { exact: true }).click();
const episodeForm = page.getByRole("form", { name: "Download link form episode" });
await episodeForm.getByPlaceholder("https://t.me/…, https://…, tg://…, or magnet:…").fill("https://t.me/browser/1080");
await episodeForm.getByRole("button", { name: "Add link", exact: true }).click();
await page.getByText("Telegram", { exact: true }).waitFor();
// Upload a real file through the admin UI to the local S3-compatible mock.
await episodeForm.locator('input[type="file"]').setInputFiles({ name: "browser-episode-1080p.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 9) });
await page.getByText(/Uploaded and verified in R2/).waitFor();
await episodeForm.getByRole("button", { name: "Add link", exact: true }).click();
await page.getByText("Cloudflare R2", { exact: true }).first().waitFor();
const browserAnime = (await pool.query("SELECT id FROM media WHERE slug=$1", [`browser-anime-${run}`])).rows[0];
const browserEpisodes = (await pool.query("SELECT e.id, e.episode_number, s.id AS season_id FROM episodes e JOIN seasons s ON s.id=e.season_id WHERE s.media_id=$1 ORDER BY e.episode_number", [browserAnime.id])).rows;
const browserAnimeDetails = ok(await api(`/api/media/${browserAnime.id}`));
assert.deepEqual(new Set(browserAnimeDetails.seasons[0].episodes[0].downloadLinks.map((link) => link.quality)), new Set(["720p", "1080p"]), "batch upload should attach both per-episode qualities");
for (const episode of browserEpisodes.filter((item) => item.episode_number > 1)) {
  ok(await api("/api/download-links", { method: "POST", body: { mediaId: browserAnime.id, seasonId: episode.season_id, episodeId: episode.id, quality: "1080p", label: "1080p", url: `https://example.com/browser-episode-${episode.episode_number}-1080.mp4` } }), 201);
}
await page.goto(`${base}/anime/browser-anime-${run}`);
await page.getByRole("heading", { name: `Browser Anime ${run}` }).waitFor();
await page.getByText("Episode 1", { exact: true }).click();
await page.locator('a[title="Cloudflare R2"]').first().waitFor();
await page.getByRole("heading", { name: "720p", exact: true }).waitFor();
await page.getByRole("heading", { name: "1080p", exact: true }).waitFor();
const episodeOneCheckbox = page.getByRole("checkbox", { name: "Select episode 1 for bulk download" });
await episodeOneCheckbox.check();
await page.getByRole("button", { name: "Select All" }).click();
await page.getByText("3 selected", { exact: true }).waitFor();
await page.getByRole("button", { name: "Clear Selection" }).click();
await page.getByText("0 selected", { exact: true }).waitFor();
await page.getByRole("button", { name: "Select All" }).click();
await page.getByText("3 selected", { exact: true }).waitFor();
await page.getByLabel("Bulk download quality").selectOption("1080p");
await page.getByRole("button", { name: "Download Selected (3)" }).click();
await page.getByText("Download queue: 1 completed (handed to browser), 2 waiting, 0 skipped, 0 failed · 1080p", { exact: true }).waitFor();
await page.getByRole("button", { name: "Download next (2 remaining)" }).click();
await page.getByText("Download queue: 2 completed (handed to browser), 1 waiting, 0 skipped, 0 failed · 1080p", { exact: true }).waitFor();
await page.getByRole("button", { name: "Download next (1 remaining)" }).click();
await page.getByText("Download queue: 3 completed (handed to browser), 0 waiting, 0 skipped, 0 failed · 1080p", { exact: true }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
assert.equal(await episodeOneCheckbox.isVisible(), true, "episode selection remains available on mobile");
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "bulk controls should not cause horizontal overflow on mobile");
await page.goto(`${base}/movie/${movie.slug}`);
for (const qualityLabel of ["480p", "720p", "1080p", "4K (2160p)"]) await page.getByRole("heading", { name: qualityLabel, exact: true }).waitFor();
assert.deepEqual(errors, []);
await browser.close();

// Existing records are still present; migrations are additive.
const after = await pool.query("SELECT (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM download_links) AS links");
assert.ok(Number(after.rows[0].media) >= Number(before.rows[0].media));
const legacyStill = await pool.query("SELECT url FROM download_links WHERE media_id=$1 AND url='/uploads/videos/legacy.mp4'", [legacyMovie.id]);
assert.equal(legacyStill.rowCount, 1);
await pool.end();
console.log("E2E passed: auth/contact rate limits/CSRF, PostgreSQL request storage plus Resend success/failure notifications/admin listing/deletion, legacy files/ranges/encoded paths/zero-byte files/image optimizer, Telegram, R2 multipart video/image/archive, signed GET/HEAD/expiry/tampering, upload session guards/cleanup leases/failed cleanup, seasons, type-conversion guard, batch episodes, quality links, browser admin, object retention, open-redirect and poster validation.");
