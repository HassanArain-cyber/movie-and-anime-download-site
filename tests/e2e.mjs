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

// Auth and legacy preservation
ok(await api("/api/health"));
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
ok(await api("/api/download-links", { method: "POST", body: { mediaId: anime.id, seasonId: season.id, episodeId: ep1.id, quality: "720p", r2UploadId: epVideo.id } }), 201);
assert.equal((await api("/api/download-links", { method: "POST", body: { mediaId: movie.id, seasonId: season.id, url: "https://example.com/x" } })).res.status, 400);
assert.equal((await api(`/api/media/${anime.id}`, { method: "PATCH", body: { type: "movie" } })).res.status, 409, "anime with seasons must not be hidden by a type change");
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
const legacyStill = await pool.query("SELECT url FROM download_links WHERE media_id=$1 AND url='/uploads/videos/legacy.mp4'", [legacyMovie.id]);
assert.equal(legacyStill.rowCount, 1);
await pool.end();
console.log("E2E passed: auth/rate limits/CSRF, legacy files/ranges/encoded paths/zero-byte files/image optimizer, Telegram, R2 multipart video/image/archive, signed GET/HEAD/expiry/tampering, upload session guards/cleanup leases/failed cleanup, seasons, type-conversion guard, batch episodes, quality links, browser admin, object retention, open-redirect and poster validation.");
