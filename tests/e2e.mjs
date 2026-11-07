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

function createAnonymousApi(clientIp = "198.51.100.88") {
  let sessionCookie = "";
  return async function anonymousApi(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { "x-e2e-client-ip": clientIp, ...(body ? { "Content-Type": "application/json" } : {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) sessionCookie = setCookie.split(";")[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { res, data };
  };
}
const commentApi = createAnonymousApi();

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
  { type: "anime", title: `Jujutsu Kaisen ${run}`, slug: `jujutsu-kaisen-${run}`, year: 2024 },
  { type: "series", title: `Juju Series ${run}`, slug: `juju-series-${run}` },
  { type: "anime", title: `Dragon Ball Z ${run}`, slug: `dragon-ball-z-${run}` },
  { type: "anime", title: `Sword Art Online ${run}`, slug: `sword-art-online-${run}` },
  { type: "anime", title: `Attack on Titan ${run}`, slug: `attack-on-titan-${run}` },
];
for (const fixture of jujuFixtures) {
  await pool.query("INSERT INTO media (type, title, slug, year) VALUES ($1, $2, $3, $4)", [fixture.type, fixture.title, fixture.slug, fixture.year ?? null]);
}
const attackAnime = await pool.query("SELECT id FROM media WHERE slug=$1", [`attack-on-titan-${run}`]);
const attackSeason = await pool.query("INSERT INTO seasons (media_id, season_number, name) VALUES ($1, 1, 'Season One') RETURNING id", [attackAnime.rows[0].id]);
await pool.query("INSERT INTO episodes (media_id, season_id, episode_number, title, duration) VALUES ($1, $2, 1, 'To You, in 2000 Years', '24m'), ($1, $2, 2, 'That Day', '24m'), ($1, $2, 3, 'Shared Spotlight', '24m'), ($1, $2, 4, 'Shared Spotlight Encore', '24m')", [attackAnime.rows[0].id, attackSeason.rows[0].id]);
const filterCategory = await pool.query("INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id", [`Filter Tag ${run}`, `filter-${run}`]);
const filterFixtures = [
  ["anime", `Filter Alpha ${run}`, `filter-alpha-${run}`, 2024, filterCategory.rows[0].id, "2024-01-01T00:00:00Z"],
  ["anime", `Filter Zulu ${run}`, `filter-zulu-${run}`, 2024, filterCategory.rows[0].id, "2025-01-01T00:00:00Z"],
  ["anime", `Filter Other Year ${run}`, `filter-other-year-${run}`, 2023, filterCategory.rows[0].id, "2023-01-01T00:00:00Z"],
  ["movie", `Filter Movie 2023 ${run}`, `filter-movie-2023-${run}`, 2023, filterCategory.rows[0].id, "2023-06-01T00:00:00Z"],
  ["movie", `Filter Movie 2024 ${run}`, `filter-movie-2024-${run}`, 2024, null, "2024-06-01T00:00:00Z"],
];
for (const [type, title, slug, year, categoryId, createdAt] of filterFixtures) {
  await pool.query("INSERT INTO media (type, title, slug, year, category_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [type, title, slug, year, categoryId, createdAt]);
}
const searchSuggestions = async (query, type, year, category) => ok(await api(`/api/media?suggestions=1&q=${encodeURIComponent(query)}${type ? `&type=${type}` : ""}${year ? `&year=${year}` : ""}${category ? `&category=${category}` : ""}`));
const jujuSuggestions = await searchSuggestions("JUJU");
assert.deepEqual(new Set(jujuSuggestions.filter((item) => item.title.endsWith(run)).map((item) => item.type)), new Set(["movie", "anime", "series"]));
assert.deepEqual(await searchSuggestions("Existing"), [], "suggestions must not match descriptions");
assert.ok((await searchSuggestions("JJK")).some((item) => item.slug === `jujutsu-kaisen-${run}`), "JJK should expand to Jujutsu Kaisen");
assert.ok((await searchSuggestions("DBZ")).some((item) => item.slug === `dragon-ball-z-${run}`), "DBZ should expand to Dragon Ball Z");
assert.ok((await searchSuggestions("SAO")).some((item) => item.slug === `sword-art-online-${run}`), "SAO should expand to Sword Art Online");
for (const typo of ["Jujutsu Kasien", "Jujutsu Kasen", "Jujutsu Kaaisen"]) {
  assert.ok((await searchSuggestions(typo)).some((item) => item.slug === `jujutsu-kaisen-${run}`), `${typo} should find Jujutsu Kaisen`);
}
const animeOnlySuggestions = await searchSuggestions("Juju", "anime");
assert.ok(animeOnlySuggestions.length > 0);
assert.ok(animeOnlySuggestions.every((item) => item.type === "anime"), "anime filter must exclude movie and series suggestions");
assert.ok((await searchSuggestions("Juju", "movie")).every((item) => item.type === "movie"));
assert.ok((await searchSuggestions("Juju", "series")).every((item) => item.type === "series"));
assert.deepEqual(await searchSuggestions("JJK", "movie"), [], "a selected content type must not leak unrelated types");
const episodeSuggestions = await searchSuggestions("To You, in 2000 Years");
const episodeSuggestion = episodeSuggestions.find((item) => item.slug === `attack-on-titan-${run}` && item.resultKind === "episode");
assert.ok(episodeSuggestion, "episode hits should be returned as individual suggestions");
assert.equal(episodeSuggestion.episodeId > 0, true);
assert.deepEqual(episodeSuggestion.episodeInfo, { seasonNumber: 1, episodeNumber: 1, title: "To You, in 2000 Years" });
assert.equal(episodeSuggestions.filter((item) => item.resultKind === "episode" && item.slug === `attack-on-titan-${run}`).length, 1);
assert.ok(episodeSuggestions.every((item) => item.resultKind === "title" || item.resultKind === "episode"));
const sameParentEpisodeSuggestions = await searchSuggestions("Shared Spotlight");
const individualEpisodeResults = sameParentEpisodeSuggestions.filter((item) => item.slug === `attack-on-titan-${run}` && item.resultKind === "episode");
assert.equal(individualEpisodeResults.length, 2, "multiple matching episodes must remain distinct instead of collapsing to one parent result");
assert.equal(new Set(individualEpisodeResults.map((item) => item.episodeId)).size, 2);
assert.deepEqual(new Set(await searchSuggestions(run, "anime", 2024, `filter-${run}`).then((items) => items.filter((item) => item.slug.startsWith("filter-")).map((item) => item.slug))), new Set([
  `filter-alpha-${run}`, `filter-zulu-${run}`,
]), "year, type, and tag filters must combine for suggestions");

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

// Anonymous title and episode discussions, unlimited threaded replies,
// duplicate-like prevention, spoiler data, reports, and server-side moderation.
assert.equal((await api("/api/admin/comments", { auth: false })).res.status, 401, "comment moderation must require admin authentication");
assert.equal((await api("/api/admin/comments/1", { method: "PATCH", auth: false, body: { isHidden: true } })).res.status, 401);
const titleDiscussionPath = `/api/comments?mediaId=${movie.id}`;
const emptyDiscussion = ok(await commentApi(titleDiscussionPath));
assert.equal(emptyDiscussion.count, 0);
assert.equal(emptyDiscussion.enabled, true);
const spoilerComment = ok(await commentApi("/api/comments", { method: "POST", body: { mediaId: movie.id, body: "The final scene reveals the hidden truth.", isSpoiler: true, website: "" } }), 201);
const threadReply = ok(await commentApi("/api/comments", { method: "POST", body: { mediaId: movie.id, parentId: spoilerComment.id, body: "That reveal was beautifully set up.", website: "" } }), 201);
assert.ok(threadReply.id > spoilerComment.id);
const likedOnce = ok(await commentApi(`/api/comments/${spoilerComment.id}/like`, { method: "PUT" }));
const likedTwice = ok(await commentApi(`/api/comments/${spoilerComment.id}/like`, { method: "PUT" }));
assert.equal(likedOnce.likeCount, 1);
assert.equal(likedTwice.likeCount, 1, "repeating a like from one anonymous session must not duplicate it");
const reportResult = ok(await commentApi(`/api/comments/${spoilerComment.id}/report`, { method: "POST", body: { reason: "spoiler", details: "Please confirm this is marked clearly." } }), 201);
assert.equal(reportResult.success, true);
assert.equal((await commentApi(`/api/comments/${spoilerComment.id}/report`, { method: "POST", body: { reason: "spoiler" } })).res.status, 409, "one anonymous session may report a comment only once");
const noPrivateCommentFields = ok(await commentApi(titleDiscussionPath));
assert.equal(noPrivateCommentFields.count, 2);
assert.ok(noPrivateCommentFields.comments.some((item) => item.id === spoilerComment.id && item.isSpoiler));
assert.ok(noPrivateCommentFields.comments.every((item) => !("authorHash" in item) && !("sessionHash" in item)));
const maliciousComment = createAnonymousApi();
assert.equal((await maliciousComment("/api/comments", { method: "POST", body: { mediaId: movie.id, body: "<script>alert(1)</script>" } })).res.status, 400, "comment API must reject executable HTML");
const allCommentRows = ok(await api("/api/admin/comments?view=all"));
assert.ok(allCommentRows.comments.some((comment) => comment.id === spoilerComment.id));
assert.ok(allCommentRows.comments.every((comment) => !("authorHash" in comment) && !("sessionHash" in comment)));
const reportRows = ok(await api("/api/admin/comments?status=pending"));
const reportRow = reportRows.find((report) => report.commentId === spoilerComment.id);
assert.ok(reportRow, "Admin should be able to review a reported comment");
assert.equal(reportRow.reason, "spoiler");
assert.ok(!("reporterHash" in reportRow) && !("authorHash" in reportRow));
const reportId = reportRow.id;
ok(await api(`/api/admin/comment-reports/${reportId}`, { method: "PATCH", body: { status: "reviewed" } }));
ok(await api(`/api/admin/comments/${spoilerComment.id}`, { method: "PATCH", body: { isHidden: true } }));
const hiddenThread = ok(await commentApi(titleDiscussionPath));
assert.equal(hiddenThread.count, 0, "hiding a parent also hides its replies from public discussions");
ok(await api(`/api/admin/comments/${spoilerComment.id}`, { method: "PATCH", body: { isHidden: false } }));
assert.equal(ok(await commentApi(titleDiscussionPath)).count, 2);
ok(await api(`/api/admin/comment-reports/${reportId}`, { method: "PATCH", body: { status: "resolved" } }));
const episodeComment = ok(await commentApi(`/api/comments?mediaId=${anime.id}&episodeId=${ep1.id}`, { method: "GET" }));
assert.equal(episodeComment.count, 0);
const episodePost = ok(await commentApi("/api/comments", { method: "POST", body: { mediaId: anime.id, episodeId: ep1.id, body: "This episode has great pacing." } }), 201);
assert.ok(episodePost.id > 0);
assert.equal(ok(await commentApi(`/api/comments?mediaId=${anime.id}`)).count, 0, "episode comments must not leak into title-level discussions");
assert.equal(ok(await commentApi(`/api/comments?mediaId=${anime.id}&episodeId=${ep1.id}`)).count, 1);
const commentRateResults = [];
for (let attempt = 0; attempt < 4; attempt++) commentRateResults.push((await commentApi(`/api/comments/${threadReply.id}/like`, { method: "PUT" })).res.status);
assert.deepEqual(commentRateResults, [200, 200, 200, 429], "anonymous comment actions should be rate-limited per session");
ok(await api(`/api/episodes/${ep1.id}`, { method: "PATCH", body: { commentsEnabled: false } }));
assert.equal(ok(await commentApi(`/api/comments?mediaId=${anime.id}&episodeId=${ep1.id}`)).enabled, false);
assert.equal((await commentApi("/api/comments", { method: "POST", body: { mediaId: anime.id, episodeId: ep1.id, body: "Comments should now be disabled." } })).res.status, 403);
ok(await api(`/api/episodes/${ep1.id}`, { method: "PATCH", body: { commentsEnabled: true } }));
ok(await api(`/api/media/${movie.id}`, { method: "PATCH", body: { commentsEnabled: false } }));
assert.equal(ok(await commentApi(titleDiscussionPath)).enabled, false);
assert.equal((await commentApi("/api/comments", { method: "POST", body: { mediaId: movie.id, body: "Title comments should now be disabled." } })).res.status, 403);
ok(await api(`/api/media/${movie.id}`, { method: "PATCH", body: { commentsEnabled: true } }));

// Unlimited nested replies: the existing comments.parent_id self-FK is reused
// with no new migration. Any comment or reply can be a parent at any depth;
// likes, spoilers, reports, and admin moderation still apply to the whole tree.
const nestedMedia = ok(await api("/api/media", { method: "POST", body: { type: "movie", title: `Nested Thread ${run}` } }), 201);
const nestedDiscussionPath = `/api/comments?mediaId=${nestedMedia.id}`;
const deepApi = createAnonymousApi("198.51.100.89");
assert.equal(ok(await deepApi(nestedDiscussionPath)).count, 0);
const deepBodies = [
  `Nested root ${run}`,
  `Nested level one ${run}`,
  `Nested level two ${run}`,
  `Nested level three ${run}`,
  `Nested level four ${run}`,
  `Nested level five ${run}`,
  `Nested level six ${run}`,
  `Nested level seven ${run}`,
];
// Two sessions keep the chain well past the UI's indentation cap without
// exhausting the per-session comment action quota.
const deepApiExtra = createAnonymousApi("198.51.100.92");
const deepChain = [];
for (let level = 0; level < deepBodies.length; level++) {
  const poster = level < 6 ? deepApi : deepApiExtra;
  deepChain.push(ok(await poster("/api/comments", {
    method: "POST",
    body: {
      mediaId: nestedMedia.id,
      ...(level > 0 ? { parentId: deepChain[level - 1].id } : {}),
      body: deepBodies[level],
      isSpoiler: level === 4,
      website: "",
    },
  }), 201));
}
const deepestId = deepChain.at(-1).id;
const deepThread = ok(await deepApi(nestedDiscussionPath));
assert.equal(deepThread.count, deepChain.length, "every nesting level is returned by the public API");
assert.deepEqual(
  deepChain.map((comment) => {
    const row = deepThread.comments.find((candidate) => candidate.id === comment.id);
    return row ? row.parentId : "missing";
  }),
  [null, ...deepChain.slice(0, -1).map((comment) => comment.id)],
  "each reply keeps its exact parent at every depth",
);
assert.equal(deepThread.comments.find((row) => row.id === deepChain[4].id)?.isSpoiler, true, "spoiler flags work on deep replies");
assert.ok(deepThread.comments.every((row) => !("authorHash" in row) && !("sessionHash" in row)), "deep threads never expose private hashes");
assert.equal((await deepApi("/api/comments", { method: "POST", body: { mediaId: movie.id, parentId: deepChain[2].id, body: `Cross discussion reply ${run}` } })).res.status, 400, "a reply cannot attach to a different discussion");
assert.equal(ok(await deepApi(`/api/comments/${deepestId}/like`, { method: "PUT" })).likeCount, 1, "deep replies can be liked");
ok(await deepApi(`/api/comments/${deepestId}/report`, { method: "POST", body: { reason: "other" } }), 201);
const deepAdminRows = ok(await api("/api/admin/comments?view=all"));
assert.ok(deepChain.every((comment) => deepAdminRows.comments.some((row) => row.id === comment.id)), "admins can moderate every nesting level");
ok(await api(`/api/admin/comments/${deepChain[0].id}`, { method: "PATCH", body: { isHidden: true } }));
assert.equal(ok(await deepApi(nestedDiscussionPath)).count, 0, "hiding a root hides the entire nested subtree");
ok(await api(`/api/admin/comments/${deepChain[0].id}`, { method: "PATCH", body: { isHidden: false } }));
ok(await api(`/api/admin/comments/${deepChain[1].id}`, { method: "PATCH", body: { isHidden: true } }));
assert.equal(ok(await deepApi(nestedDiscussionPath)).count, 1, "hiding a mid-thread reply hides all of its descendants");
assert.equal((await deepApi(`/api/comments/${deepestId}/like`, { method: "PUT" })).res.status, 404, "likes cannot reach descendants of a hidden ancestor");
const blockedReplyApi = createAnonymousApi("198.51.100.90");
assert.equal((await blockedReplyApi("/api/comments", { method: "POST", body: { mediaId: nestedMedia.id, parentId: deepChain[3].id, body: `Hidden ancestor reply ${run}` } })).res.status, 400, "replies cannot resurrect a hidden thread");
ok(await api(`/api/admin/comments/${deepChain[1].id}`, { method: "PATCH", body: { isHidden: false } }));
assert.equal(ok(await deepApi(nestedDiscussionPath)).count, deepChain.length, "restoring an ancestor restores all nesting levels");
assert.equal((await createAnonymousApi("198.51.100.91")("/api/comments", { method: "POST", body: { mediaId: nestedMedia.id, parentId: 2147483647, body: `Missing parent reply ${run}` } })).res.status, 400, "unknown reply targets are rejected");

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
// Let initial hydration/dev asset updates settle before testing a full reload.
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.evaluate(() => window.localStorage.removeItem("vault-brand-icon"));
await page.reload({ waitUntil: "networkidle" });
const desktopBrandIcon = page.getByTestId("brand-scroll-top");
assert.equal(await desktopBrandIcon.getAttribute("data-brand-icon"), "vault");
const desktopHeroTypography = await page.getByRole("heading", { name: "Your movies, anime & series. One click away." }).evaluate((heading) => ({
  heading: getComputedStyle(heading).fontSize,
  paragraph: getComputedStyle(heading.parentElement.querySelector("p")).fontSize,
}));
assert.deepEqual(desktopHeroTypography, { heading: "60px", paragraph: "16px" }, "desktop hero should have prominent reference-inspired typography");
await page.getByRole("button", { name: "Choose brand icon" }).click();
const desktopIconPicker = page.getByRole("group", { name: "Brand icon choices" });
const desktopPickerBounds = await desktopIconPicker.boundingBox();
assert.ok(desktopPickerBounds && desktopPickerBounds.x >= 0 && desktopPickerBounds.x + desktopPickerBounds.width <= 1280, "desktop icon picker should fit the viewport");
await desktopIconPicker.getByRole("button", { name: "Use Film icon" }).click();
assert.equal(await desktopBrandIcon.getAttribute("data-brand-icon"), "film");
assert.equal(await page.evaluate(() => window.localStorage.getItem("vault-brand-icon")), "film");
await page.reload();
await page.waitForFunction(() => document.querySelector('[data-testid="brand-scroll-top"]')?.getAttribute("data-brand-icon") === "film");
assert.equal(await page.getByTestId("brand-scroll-top").getAttribute("data-brand-icon"), "film", "brand icon choice should persist after refresh");

// Global scroll controls work without navigation on desktop and narrow mobile pages.
const frameNavigations = [];
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) frameNavigations.push(page.url());
});
await page.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.id = "e2e-scroll-control-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.height = "1600px";
  document.body.append(spacer);
});
const desktopScrollUrl = page.url();
const desktopToggle = page.getByTestId("page-scroll-toggle");
assert.equal(await desktopToggle.getAttribute("aria-label"), "Scroll to bottom");
const desktopScrollBounds = await desktopToggle.boundingBox();
assert.ok(desktopScrollBounds && desktopScrollBounds.width >= 44 && desktopScrollBounds.height >= 44, "desktop scroll control should have a usable hit target");
assert.ok(desktopScrollBounds.x >= 0 && desktopScrollBounds.x + desktopScrollBounds.width <= 1280, "desktop scroll control should remain inside the viewport");
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForFunction(() => document.querySelector('[data-testid="page-scroll-toggle"]')?.getAttribute("aria-label") === "Scroll to top");
const desktopNavigationCount = frameNavigations.length;
await page.getByTestId("brand-scroll-top").click();
await page.waitForFunction(() => window.scrollY <= 2);
await page.waitForFunction(() => document.querySelector('[data-testid="page-scroll-toggle"]')?.getAttribute("aria-label") === "Scroll to bottom");
assert.equal(page.url(), desktopScrollUrl, "brand icon must not navigate");
assert.equal(frameNavigations.length, desktopNavigationCount, "brand icon must not reload the page");
assert.equal(await desktopToggle.getAttribute("aria-label"), "Scroll to bottom");
await desktopToggle.click();
await page.waitForFunction(() => document.querySelector('[data-testid="page-scroll-toggle"]')?.getAttribute("aria-label") === "Scroll to top");
await page.waitForFunction(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
await desktopToggle.click();
await page.waitForFunction(() => window.scrollY <= 2);
assert.equal(page.url(), desktopScrollUrl, "floating control must not navigate");
assert.equal(frameNavigations.length, desktopNavigationCount, "floating control must not reload the page");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/`);
const mobileHeroTypography = await page.getByRole("heading", { name: "Your movies, anime & series. One click away." }).evaluate((heading) => ({
  heading: getComputedStyle(heading).fontSize,
  paragraph: getComputedStyle(heading.parentElement.querySelector("p")).fontSize,
}));
assert.deepEqual(mobileHeroTypography, { heading: "30px", paragraph: "14px" }, "mobile hero should retain readable heading hierarchy");
await page.goto(`${base}/anime`);
await page.waitForFunction(() => document.querySelector('[data-testid="brand-scroll-top"]')?.getAttribute("data-brand-icon") === "film");
assert.equal(await page.getByTestId("brand-scroll-top").getAttribute("data-brand-icon"), "film", "the desktop icon choice should carry over to mobile");
await page.getByRole("button", { name: "Choose brand icon" }).click();
const mobileIconPicker = page.getByRole("group", { name: "Brand icon choices" });
const mobilePickerBounds = await mobileIconPicker.boundingBox();
assert.ok(mobilePickerBounds && mobilePickerBounds.x >= 0 && mobilePickerBounds.x + mobilePickerBounds.width <= 390, "mobile icon picker should fit the viewport");
await mobileIconPicker.getByRole("button", { name: "Use Clapperboard icon" }).click();
assert.equal(await page.evaluate(() => window.localStorage.getItem("vault-brand-icon")), "clapperboard");
await page.reload();
await page.waitForFunction(() => document.querySelector('[data-testid="brand-scroll-top"]')?.getAttribute("data-brand-icon") === "clapperboard");
assert.equal(await page.getByTestId("brand-scroll-top").getAttribute("data-brand-icon"), "clapperboard", "mobile icon choice should persist after refresh");
const mobileLoadTime = await page.evaluate(() => performance.timeOrigin);
await page.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.id = "e2e-scroll-control-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.height = "1600px";
  document.body.append(spacer);
});
const mobileScrollUrl = page.url();
const mobileToggle = page.getByTestId("page-scroll-toggle");
const mobileScrollBounds = await mobileToggle.boundingBox();
assert.ok(mobileScrollBounds && mobileScrollBounds.width >= 44 && mobileScrollBounds.height >= 44, "mobile scroll control should have a usable hit target");
assert.ok(mobileScrollBounds.x >= 0 && mobileScrollBounds.x + mobileScrollBounds.width <= 390, "mobile scroll control should fit the viewport width");
assert.equal(await mobileToggle.getAttribute("aria-label"), "Scroll to bottom");
await mobileToggle.click();
await page.waitForFunction(() => document.querySelector('[data-testid="page-scroll-toggle"]')?.getAttribute("aria-label") === "Scroll to top");
await page.waitForFunction(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
await mobileToggle.click();
await page.waitForFunction(() => window.scrollY <= 2);
assert.equal(page.url(), mobileScrollUrl, "mobile scroll control must not navigate");
assert.equal(await page.evaluate(() => performance.timeOrigin), mobileLoadTime, "mobile scroll control must not reload the page");
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile scroll control must not cause horizontal overflow");
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/`);
assert.equal(await page.getByRole("combobox", { name: "Filter by tag" }).count(), 1, "tags should be available through a dropdown instead of a permanent list");
async function chooseFilter(control, value) {
  await control.click();
  await page.getByRole("listbox").locator(`[role="option"][data-value="${value}"]`).click();
}
const tagDropdown = page.getByRole("combobox", { name: "Filter by tag" });
await chooseFilter(tagDropdown, "legacy");
await page.waitForURL((url) => url.searchParams.get("category") === "legacy");
await page.locator(".grid").getByText("Legacy Movie", { exact: true }).waitFor();
assert.equal(await page.locator(".grid").getByText("Legacy Anime", { exact: true }).count(), 0, "selected tag should filter out uncategorized titles");
await chooseFilter(tagDropdown, "");
await page.waitForURL((url) => !url.searchParams.has("category"));
await page.locator(".grid").getByText("Legacy Anime", { exact: true }).waitFor();

const yearDropdown = page.getByRole("combobox", { name: "Filter by release year" });
const sortDropdown = page.getByRole("combobox", { name: "Sort library" });
await yearDropdown.click();
assert.equal(await page.getByRole("listbox").locator('[data-value="2024"]').count(), 1);
assert.equal(await page.getByRole("listbox").locator('[data-value="2023"]').count(), 1);
await page.getByRole("listbox").press("Escape");
await page.goto(`${base}/?type=anime&year=2024&category=filter-${run}&sort=az`);
assert.deepEqual(await page.locator(".grid h3").allTextContents(), [`Filter Alpha ${run}`, `Filter Zulu ${run}`], "Anime + 2024 + A-Z should filter and sort together");
await chooseFilter(sortDropdown, "za");
await page.waitForURL((url) => url.searchParams.get("sort") === "za" && url.searchParams.get("type") === "anime" && url.searchParams.get("year") === "2024" && url.searchParams.get("category") === `filter-${run}`);
assert.deepEqual(await page.locator(".grid h3").allTextContents(), [`Filter Zulu ${run}`, `Filter Alpha ${run}`], "Z-A should reverse the title order without dropping other filters");
await chooseFilter(sortDropdown, "newest");
await page.waitForURL((url) => !url.searchParams.has("sort") && url.searchParams.get("category") === `filter-${run}`);
assert.deepEqual(await page.locator(".grid h3").allTextContents(), [`Filter Zulu ${run}`, `Filter Alpha ${run}`], "newest-first should use creation timestamps");
await chooseFilter(sortDropdown, "oldest");
await page.waitForURL((url) => url.searchParams.get("sort") === "oldest");
assert.deepEqual(await page.locator(".grid h3").allTextContents(), [`Filter Alpha ${run}`, `Filter Zulu ${run}`], "oldest-first should reverse creation order");
await page.goto(`${base}/?type=movie&year=2023&category=filter-${run}`);
assert.deepEqual(await page.locator(".grid h3").allTextContents(), [`Filter Movie 2023 ${run}`], "Movies + 2023 + tag should exclude other years and content types");
await page.goto(`${base}/anime?year=2024&category=filter-${run}&sort=az`);
assert.deepEqual(await page.locator(".grid h3").allTextContents(), [`Filter Alpha ${run}`, `Filter Zulu ${run}`], "type pages should use the same combined library filters");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/?type=anime&year=2024&category=filter-${run}&sort=az`);
const libraryFilterBounds = await page.locator('[aria-label="Library filters"]').boundingBox();
assert.ok(libraryFilterBounds && libraryFilterBounds.x >= 0 && libraryFilterBounds.x + libraryFilterBounds.width <= 390, "combined filter controls should fit the mobile viewport");
// The type dropdown must retain compatible filters; reset clears the entire query.
await chooseFilter(page.getByRole("combobox", { name: "Filter by content type" }), "movie");
await page.waitForURL((url) => url.searchParams.get("type") === "movie" && url.searchParams.get("year") === "2024" && url.searchParams.get("category") === `filter-${run}`);
assert.equal(await page.getByRole("combobox", { name: "Filter by content type" }).getAttribute("data-active"), "true");
await page.getByRole("button", { name: "Reset filters" }).click();
await page.waitForURL((url) => url.pathname === "/" && url.search === "");
assert.equal(await page.getByRole("combobox", { name: "Filter by content type" }).getAttribute("data-value"), "");
for (let index = 0; index < 20; index++) ok(await api("/api/categories", { method: "POST", body: { name: `Menu category ${run} ${index}`, slug: `menu-${run}-${index}` } }), 201);
await page.reload({ waitUntil: "networkidle" });
for (const width of [360, 390, 768, 1280]) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `library should fit at ${width}px`);
  const compactLayout = await page.evaluate(() => {
    const hero = document.querySelector('.vault-hero');
    const selects = [...document.querySelectorAll('.vault-filters [role="combobox"]')].map((select) => select.getBoundingClientRect());
    const actions = [...document.querySelectorAll('.vault-hero-actions a')].map((link) => link.getBoundingClientRect());
    return { heroHeight: hero.getBoundingClientRect().height, filterHeights: selects.map((rect) => rect.height), filterTops: selects.map((rect) => rect.top), actionHeights: actions.map((rect) => rect.height) };
  });
  assert.ok(compactLayout.filterHeights.every((height) => height <= 38), 'filter controls should stay compact');
  assert.ok(compactLayout.filterTops.every((top) => Math.abs(top - compactLayout.filterTops[0]) < 1), 'the four filters should fit on one row');
  if (width <= 390) {
    assert.ok(compactLayout.heroHeight <= 410, `hero should be compact at ${width}px`);
    assert.ok(compactLayout.actionHeights.every((height) => height >= 44), 'hero actions should retain usable tap targets');
  }
  assert.equal(await page.getByRole('link', { name: 'Admin', exact: true }).getAttribute('href'), '/admin');
  await page.getByRole("combobox", { name: "Filter by tag" }).click();
  const menuBox = await page.getByRole("listbox").evaluate((menu) => { const r = menu.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, scrollable: menu.scrollHeight > menu.clientHeight }; });
  assert.ok(menuBox.left >= 0 && menuBox.right <= width && menuBox.top >= 0 && menuBox.bottom <= 900, 'filter menu stays within viewport');
  assert.ok(menuBox.height <= 242 && menuBox.scrollable, 'many tags use a bounded scrolling popup');
  await page.getByRole("listbox").press("End");
  assert.equal(await page.getByRole("listbox").count(), 1, 'internal scrolling must not close the menu');
  await page.getByRole("listbox").press("Escape");
  const posterLayout = await page.locator('.vault-poster-grid').evaluate((grid) => ({ columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, featured: grid.querySelectorAll('.vault-card-featured').length }));
  assert.ok(posterLayout.columns >= 4 && posterLayout.featured === 1, 'collection uses a lead poster and compact supporting grid');
}
// Real touch input should scroll the app-owned popup rather than close it or scroll the page.
// Reuse the existing context: the Lambda Chromium single-process build cannot safely close a second context.
const touchPage = page;
await touchPage.setViewportSize({ width: 360, height: 800 });
await touchPage.goto(`${base}/`, { waitUntil: "networkidle" });
await touchPage.getByRole("combobox", { name: "Filter by tag" }).click();
const touchMenu = touchPage.getByRole("listbox");
const touchBounds = await touchMenu.boundingBox();
const cdp = await context.newCDPSession(touchPage);
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
const touchX = touchBounds.x + touchBounds.width / 2;
const touchY = touchBounds.y + touchBounds.height - 20;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
for (let step = 1; step <= 6; step++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX, y: touchY - step * 20 }] });
  await touchPage.waitForTimeout(40);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await touchPage.waitForFunction(() => document.querySelector('[role="listbox"]')?.scrollTop > 0);
assert.equal(await touchMenu.count(), 1, "touch-scrolling keeps the menu open");
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
await cdp.detach();
await touchMenu.press("Escape");
await page.setViewportSize({ width: 1280, height: 900 });

const searchBox = page.getByRole("combobox", { name: "Search movies, anime, and series" });
const suggestions = page.locator("#search-suggestions");
await page.goto(`${base}/?type=anime`);
if (await page.getByRole("button", { name: "Open anime search", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Open anime search", exact: true }).click();
await searchBox.fill("Juju");
await suggestions.getByText(`Jujutsu Kaisen ${run}`, { exact: true }).waitFor();
const desktopSearchLayout = await suggestions.evaluate((dropdown) => {
  const dropdownRect = dropdown.getBoundingClientRect();
  const searchRect = dropdown.closest("form").getBoundingClientRect();
  const card = dropdown.querySelector("a");
  const cardRect = card.getBoundingClientRect();
  return { left: dropdownRect.left, right: dropdownRect.right, width: dropdownRect.width, centerDelta: Math.abs((dropdownRect.left + dropdownRect.right) / 2 - (searchRect.left + searchRect.right) / 2), cardWidth: cardRect.width, cardClass: card.className };
});
assert.ok(desktopSearchLayout.left >= 0 && desktopSearchLayout.right <= 1280, "desktop suggestions should remain inside the viewport");
assert.ok(desktopSearchLayout.width > 320 && desktopSearchLayout.width <= 672, "desktop dropdown should be wider than the search field without becoming unbounded");
assert.ok(desktopSearchLayout.centerDelta < 1, "desktop dropdown should stay centered relative to the search bar");
assert.ok(desktopSearchLayout.cardClass.includes("grid-cols-1"), "suggestions should use a clear card row with separate title and metadata areas");
const titleSuggestion = suggestions.getByRole("link", { name: new RegExp(`Jujutsu Kaisen ${run}.*Anime`) });
assert.match(await titleSuggestion.innerText(), /Anime/);
assert.match(await titleSuggestion.innerText(), /2024/);
const animeSuggestionHrefs = await suggestions.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
assert.ok(animeSuggestionHrefs.length > 0 && animeSuggestionHrefs.every((href) => href?.startsWith("/anime/")), "selected Anime filter must scope every live suggestion");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/?type=movie`);
if (await page.getByRole("button", { name: "Open anime search", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Open anime search", exact: true }).click();
await searchBox.fill("Juju");
await suggestions.getByText(`Juju Movie ${run}`, { exact: true }).waitFor();
const mobileSuggestionBounds = await suggestions.boundingBox();
assert.ok(mobileSuggestionBounds && mobileSuggestionBounds.x >= 0 && mobileSuggestionBounds.x + mobileSuggestionBounds.width <= 390, "mobile suggestions should stay within the viewport");
const movieSuggestionHrefs = await suggestions.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
assert.ok(movieSuggestionHrefs.length > 0 && movieSuggestionHrefs.every((href) => href?.startsWith("/movie/")), "selected Movies filter must scope mobile suggestions");
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/`);
if (await page.getByRole("button", { name: "Open anime search", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Open anime search", exact: true }).click();
await searchBox.fill("To You, in 2000 Years");
const episodeAnchor = suggestions.locator('a[href*="#episode-"]');
await episodeAnchor.waitFor();
const episodeHref = await episodeAnchor.getAttribute("href");
assert.match(episodeHref, new RegExp(`/anime/attack-on-titan-${run}#episode-\\d+`));
const episodeRowText = await episodeAnchor.innerText();
assert.match(episodeRowText, /To You, in 2000 Years/);
assert.match(episodeRowText, /From Attack on Titan/);
assert.match(episodeRowText, /Season 1 · Episode 1/);
assert.match(episodeRowText, /Anime/);
assert.match(episodeRowText, /Episode/);
await episodeAnchor.click();
await page.waitForURL((url) => url.pathname === `/anime/attack-on-titan-${run}` && /^#episode-\d+$/.test(url.hash));
await page.locator(new URL(page.url()).hash).waitFor();
await page.goto(`${base}/`);
if (await page.getByRole("button", { name: "Open anime search", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Open anime search", exact: true }).click();
await searchBox.fill("NoSuchVaultTitle");
await suggestions.getByText(/No matching results found/).waitFor();
if (await page.getByRole("button", { name: "Open anime search", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Open anime search", exact: true }).click();
await searchBox.fill("");
await searchBox.pressSequentially("Juju", { delay: 35 });
await suggestions.getByText(`Juju Movie ${run}`, { exact: true }).waitFor();
await suggestions.getByText(`Jujutsu Kaisen ${run}`, { exact: true }).waitFor();
await suggestions.getByText(`Juju Series ${run}`, { exact: true }).waitFor();
assert.equal(new URL(page.url()).searchParams.has("q"), false, "suggestions should appear before submitting the search");
await suggestions.getByRole("link", { name: new RegExp(`Jujutsu Kaisen ${run}.*Anime`) }).click();
await page.waitForURL((url) => url.pathname === `/anime/jujutsu-kaisen-${run}`);
await page.getByRole("heading", { name: `Jujutsu Kaisen ${run}` }).waitFor();

if (await page.getByRole("button", { name: "Open anime search", exact: true }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "Open anime search", exact: true }).click();
await searchBox.fill("Legacy");
await searchBox.press("Enter");
await page.waitForURL((url) => url.pathname === "/" && url.searchParams.get("q") === "Legacy" && url.searchParams.get("type") === "anime");
await page.getByRole("heading", { name: /Search results for/ }).waitFor();

// Public comment surfaces render safely, reveal spoilers on demand, and remain
// within desktop and narrow mobile viewports for title and episode discussions.
await page.goto(`${base}/movie/${movie.slug}`);
const titleCommentPanel = page.locator('[aria-label="Title comments"]');
await titleCommentPanel.getByRole("heading", { name: /Community comments/ }).waitFor();
await titleCommentPanel.getByRole("button", { name: "Show Spoiler" }).waitFor();
const desktopCommentBounds = await titleCommentPanel.boundingBox();
assert.ok(desktopCommentBounds && desktopCommentBounds.x >= 0 && desktopCommentBounds.x + desktopCommentBounds.width <= 1280, "desktop title comments should fit the viewport");
await titleCommentPanel.getByRole("button", { name: "Show Spoiler" }).click();
await titleCommentPanel.getByText("The final scene reveals the hidden truth.", { exact: true }).waitFor();
await page.getByRole("textbox", { name: "Write a comment" }).fill(`Browser comment ${run}`);
await page.getByRole("button", { name: "Post comment" }).click();
await titleCommentPanel.getByRole("status").getByText("Comment posted.").waitFor();
await titleCommentPanel.getByText(`Browser comment ${run}`, { exact: true }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
const mobileCommentLayout = await titleCommentPanel.evaluate((section) => ({
  left: section.getBoundingClientRect().left,
  right: section.getBoundingClientRect().right,
  scrollWidth: section.scrollWidth,
  clientWidth: section.clientWidth,
}));
assert.ok(mobileCommentLayout.left >= 0 && mobileCommentLayout.right <= 390, "mobile title comments should stay within the viewport");
assert.ok(mobileCommentLayout.scrollWidth <= mobileCommentLayout.clientWidth, "title comments must not cause horizontal overflow on mobile");
await page.goto(`${base}/anime/${anime.slug}`);
const targetEpisodeRow = page.locator(`#episode-${ep1.id}`);
await targetEpisodeRow.locator("button[aria-expanded]").click();
const episodeCommentPanel = page.locator('[aria-label="Episode comments"]');
await episodeCommentPanel.getByRole("heading", { name: /Episode discussion/ }).waitFor();
await episodeCommentPanel.getByText("This episode has great pacing.", { exact: true }).waitFor();
const mobileEpisodeCommentBounds = await episodeCommentPanel.boundingBox();
assert.ok(mobileEpisodeCommentBounds && mobileEpisodeCommentBounds.x >= 0 && mobileEpisodeCommentBounds.x + mobileEpisodeCommentBounds.width <= 390, "mobile episode discussion should stay inside the viewport");
await page.setViewportSize({ width: 1280, height: 900 });

// Seed one previous-year comment directly so the browser can prove the
// conditional year rule without hardcoding the current calendar year.
const browserCurrentYear = await page.evaluate(() => new Date().getFullYear());
const previousYear = browserCurrentYear - 1;
const previousYearCommentBody = `Previous-year discussion ${run}`;
await pool.query(
  "INSERT INTO comments (media_id, author_hash, body, created_at) VALUES ($1, $2, $3, $4)",
  [nestedMedia.id, "e".repeat(64), previousYearCommentBody, `${previousYear}-11-04 04:45:00+00`],
);

// Unlimited nesting renders as a real DOM tree on desktop and mobile, with an
// inline reply composer on every node and indentation capped for narrow screens.
await page.goto(`${base}/movie/${nestedMedia.slug}`);
const nestedPanel = page.locator('[aria-label="Title comments"]');
await nestedPanel.getByRole("heading", { name: /Community comments/ }).waitFor();
await nestedPanel.locator(`[data-comment-id="${deepestId}"]`).waitFor();
assert.equal(await nestedPanel.locator('[data-testid="comment-node"]').count(), deepChain.length + 1, "the seeded previous-year comment is rendered too");
const nestedDepths = await nestedPanel.locator('[data-testid="comment-node"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-depth"))));
assert.deepEqual([...new Set(nestedDepths)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], "eight nesting levels are rendered");
const nestedParentLinks = await nestedPanel.locator('[data-testid="comment-node"]').evaluateAll((nodes) => nodes.map((node) => ({
  parent: node.getAttribute("data-parent-id") || null,
  container: node.parentElement?.closest('[data-testid="comment-node"]')?.getAttribute("data-comment-id") ?? null,
})));
assert.ok(nestedParentLinks.every((link) => link.parent === link.container), "each reply article is nested inside its parent article");

// Icon-only action bars and compact metadata apply at every nesting level.
const commentPresentation = await nestedPanel.locator('[data-testid="comment-node"]').evaluateAll((nodes) => nodes.map((node) => {
  const content = node.firstElementChild;
  const bar = content?.querySelector('[data-testid="comment-action-bar"]');
  const metadata = content?.querySelector('[data-testid="comment-metadata"]');
  const buttons = bar ? [...bar.querySelectorAll("button[data-action]")] : [];
  return {
    id: node.getAttribute("data-comment-id") ?? "",
    hasCommunityMember: (node.textContent || "").includes("Community member"),
    metadata: metadata?.textContent?.trim() ?? "",
    metadataTag: metadata?.tagName ?? "",
    metadataFontSize: metadata ? Number.parseFloat(getComputedStyle(metadata).fontSize) : 0,
    actions: buttons.map((button) => {
      const svg = button.querySelector("svg");
      const iconRect = svg?.getBoundingClientRect();
      return {
        action: button.getAttribute("data-action"),
        text: (button.textContent || "").trim(),
        ariaLabel: button.getAttribute("aria-label"),
        title: button.getAttribute("title"),
        iconName: svg?.getAttribute("data-icon") ?? "",
        iconWidth: iconRect ? Math.round(iconRect.width) : 0,
        iconHeight: iconRect ? Math.round(iconRect.height) : 0,
        height: Math.round(button.getBoundingClientRect().height),
        display: getComputedStyle(button).display,
        alignItems: getComputedStyle(button).alignItems,
      };
    }),
  };
}));
const compactDate = /^[A-Z][a-z]{2} \d{1,2}(?:, \d{4})? · \d{1,2}:\d{2} (AM|PM)$/;
assert.ok(commentPresentation.every((row) => !row.hasCommunityMember), "the Community member label is removed from every comment");
assert.ok(commentPresentation.every((row) => compactDate.test(row.metadata)), "every comment shows the compact date/time format");
const previousYearRows = commentPresentation.filter((row) => row.metadata.includes(String(previousYear)));
assert.equal(previousYearRows.length, 1, "previous-year comments show their four-digit year");
assert.match(previousYearRows[0].metadata, new RegExp(`^[A-Z][a-z]{2} \\d{1,2}, ${previousYear} · `));
assert.ok(
  commentPresentation.filter((row) => !row.metadata.includes(String(previousYear))).every((row) => !row.metadata.includes(String(browserCurrentYear))),
  "current-year comments hide the year dynamically",
);
assert.ok(commentPresentation.every((row) => row.metadataTag === "TIME"), "timestamps use semantic time elements");
assert.ok(commentPresentation.every((row) => row.metadataFontSize > 0 && row.metadataFontSize <= 12), "metadata stays smaller and subtler than comment text");
assert.ok(commentPresentation.every((row) => row.actions.length === 3), "every nesting level has like, reply, and report actions");
// Chromium computes `inline-flex` on <button> as `flex`; both are centered flex layouts.
assert.ok(commentPresentation.every((row) => row.actions.every((action) => action.display.includes("flex") && action.alignItems === "center")), "action icons are consistently aligned");
assert.ok(commentPresentation.every((row) => row.actions.every((action) => action.iconWidth === 16 && action.iconHeight === 16)), "action icons share one 16px size");
assert.ok(commentPresentation.every((row) => row.actions.every((action) => Math.abs(action.height - row.actions[0].height) <= 1)), "action buttons share one height");
assert.ok(commentPresentation.every((row) => row.actions.every((action) => action.ariaLabel && action.title)), "every icon has an accessible label and tooltip");
assert.ok(commentPresentation.every((row) => row.actions.every((action) => /like|reply|report/i.test(action.title))), "tooltips explain each action");
assert.deepEqual(commentPresentation.map((row) => row.actions.map((action) => action.iconName)), Array(commentPresentation.length).fill(["thumbs-up", "reply", "flag"]), "thumbs-up, reply, and flag icons are used at every depth");
const deepestPresentation = commentPresentation.find((row) => row.id === String(deepestId));
assert.ok(deepestPresentation, "the deepest reply is present in the rendered tree");
const deepestActions = deepestPresentation.actions;
assert.match(deepestActions.find((action) => action.action === "like").text, /^\d+$/, "the like count stays visible as the only like-button text");
assert.match(deepestActions.find((action) => action.action === "like").ariaLabel, /like/i);
assert.equal(deepestActions.find((action) => action.action === "reply").text, "", "reply is icon-only");
assert.equal(deepestActions.find((action) => action.action === "report").text, "", "report is icon-only");
const deepestNode = nestedPanel.locator(`[data-comment-id="${deepestId}"]`);
assert.equal(await deepestNode.locator('[data-action="reply"]').count(), 1, "the deepest reply can itself be replied to");
await deepestNode.getByText("Reply · level 7", { exact: true }).waitFor();
const desktopDepthLefts = [];
for (const comment of deepChain) {
  const box = await nestedPanel.locator(`[data-comment-id="${comment.id}"]`).boundingBox();
  desktopDepthLefts.push(box ? box.x : -1);
}
assert.ok(desktopDepthLefts.every((left, index) => index === 0 || left >= desktopDepthLefts[index - 1]), "desktop replies never move left as depth grows");
assert.ok(desktopDepthLefts.slice(0, 7).every((left, index) => index === 0 || left > desktopDepthLefts[index - 1]), "desktop replies are indented until the display cap");
assert.ok(Math.abs(desktopDepthLefts[7] - desktopDepthLefts[6]) <= 1, "indentation stops growing after the display cap while nesting continues");
const desktopNestedBounds = await nestedPanel.boundingBox();
assert.ok(desktopNestedBounds && desktopNestedBounds.x >= 0 && desktopNestedBounds.x + desktopNestedBounds.width <= 1280, "nested desktop comments fit the viewport");
const levelThreeActions = nestedPanel.locator(`[data-actions-for="${deepChain[3].id}"]`);
await levelThreeActions.locator('[data-action="reply"]').click();
const levelThreeNode = nestedPanel.locator(`[data-comment-id="${deepChain[3].id}"]`);
await levelThreeNode.getByRole("textbox", { name: new RegExp(`Write a reply to comment ${deepChain[3].id}`) }).fill(`Browser nested reply ${run}`);
await levelThreeNode.getByRole("button", { name: "Post reply" }).click();
await nestedPanel.getByRole("status").getByText("Reply posted.").waitFor();
// Ancestor articles also contain the reply text; the last match is the node itself.
const browserNestedReply = nestedPanel.locator('[data-testid="comment-node"]').filter({ hasText: `Browser nested reply ${run}` }).last();
await browserNestedReply.waitFor();
assert.equal(await browserNestedReply.getAttribute("data-parent-id"), String(deepChain[3].id));
assert.equal(Number(await browserNestedReply.getAttribute("data-depth")), 4, "an inline reply to a level-3 comment is level 4");
assert.equal(await nestedPanel.locator('[data-testid="comment-node"]').count(), deepChain.length + 2, "the inline reply is added alongside the previous-year comment");
await page.setViewportSize({ width: 390, height: 844 });
const mobileNestedLayout = await nestedPanel.evaluate((section) => ({
  left: section.getBoundingClientRect().left,
  right: section.getBoundingClientRect().right,
  scrollWidth: section.scrollWidth,
  clientWidth: section.clientWidth,
}));
assert.ok(mobileNestedLayout.left >= 0 && mobileNestedLayout.right <= 390, "deeply nested mobile comments stay inside the viewport");
assert.ok(mobileNestedLayout.scrollWidth <= mobileNestedLayout.clientWidth, "deep nesting must not cause horizontal overflow on mobile");
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "nested comments must not overflow the mobile document");
const mobilePresentation = await nestedPanel.locator('[data-testid="comment-node"]').evaluateAll((nodes) => nodes.map((node) => {
  const bar = node.firstElementChild?.querySelector('[data-testid="comment-action-bar"]');
  const metadata = node.firstElementChild?.querySelector('[data-testid="comment-metadata"]');
  const buttons = bar ? [...bar.querySelectorAll("button[data-action]")] : [];
  return {
    actionCount: buttons.length,
    iconWidths: buttons.map((button) => Math.round(button.querySelector("svg")?.getBoundingClientRect().width ?? 0)),
    metadataWidth: metadata ? Math.round(metadata.getBoundingClientRect().width) : 0,
  };
}));
assert.ok(mobilePresentation.every((row) => row.actionCount === 3 && row.iconWidths.every((width) => width === 16) && row.metadataWidth > 0), "icon actions and compact metadata stay intact on mobile");
const mobileMetadata = await nestedPanel.locator('[data-testid="comment-metadata"]').allTextContents();
assert.ok(mobileMetadata.every((text) => compactDate.test(text.trim())), "compact timestamps remain exact on mobile");
assert.equal(mobileMetadata.filter((text) => text.includes(String(previousYear))).length, 1, "previous-year comments keep their year on mobile");
assert.ok(
  mobileMetadata.filter((text) => !text.includes(String(previousYear))).every((text) => !text.includes(String(browserCurrentYear))),
  "current-year comments hide the year on mobile",
);
const mobileDeepestBounds = await nestedPanel.locator(`[data-comment-id="${deepestId}"]`).boundingBox();
assert.ok(mobileDeepestBounds && mobileDeepestBounds.x >= 0 && mobileDeepestBounds.x + mobileDeepestBounds.width <= 390, "the deepest reply remains readable on mobile");
await page.setViewportSize({ width: 1280, height: 900 });

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
const confirmedDialogs = [];
page.on("dialog", (dialog) => { confirmedDialogs.push(dialog.message()); void dialog.accept(); });
await page.getByRole("button", { name: "Delete request from E2E request sender" }).click();
await page.getByRole("status").getByText("Request deleted.").waitFor();
await page.getByText("E2E request sender", { exact: true }).waitFor({ state: "detached" });
const remainingRequests = ok(await api("/api/contact/requests"));
assert.ok(remainingRequests.some((request) => request.id === sentContact.data.id), "deleting one request must preserve other submitted requests");
await page.getByRole("button", { name: "Comment moderation" }).click();
await page.getByRole("heading", { name: "Comment moderation" }).waitFor();
await page.getByLabel("Moderation view").selectOption("comments");
const unreportedEpisodeComment = page.locator("article").filter({ hasText: "This episode has great pacing." }).first();
await unreportedEpisodeComment.waitFor();
await unreportedEpisodeComment.getByRole("button", { name: "Hide" }).click();
await page.getByRole("status").getByText("Comment hidden from the public discussion.").waitFor();
await unreportedEpisodeComment.getByRole("button", { name: "Restore" }).click();
await page.getByRole("status").getByText("Comment restored to the public discussion.").waitFor();
await page.getByLabel("Moderation view").selectOption("reports");
await page.getByLabel("Filter reports by status").selectOption("");
const moderatedComment = page.locator("article").filter({ hasText: "The final scene reveals the hidden truth." }).first();
await moderatedComment.waitFor();
await moderatedComment.getByRole("button", { name: "Hide" }).click();
await page.getByRole("status").getByText("Comment hidden from the public discussion.").waitFor();
await moderatedComment.getByRole("button", { name: "Restore" }).click();
await page.getByRole("status").getByText("Comment restored to the public discussion.").waitFor();
assert.equal(await moderatedComment.locator('[data-icon="moderation-tick"]').isVisible(), true);
assert.equal(await moderatedComment.getByRole("button", { name: "Delete", exact: true }).count(), 0, "secondary actions start collapsed");
await moderatedComment.getByRole("button", { name: "Expand comment details" }).click();
assert.equal(await moderatedComment.getByRole("button", { name: "Delete", exact: true }).isVisible(), true);
await moderatedComment.getByRole("button", { name: "Collapse comment details" }).click();
assert.equal(await moderatedComment.getByRole("button", { name: "Delete", exact: true }).count(), 0);
await moderatedComment.getByRole("button", { name: "Expand comment details" }).click();
await moderatedComment.getByLabel(/Report status for comment/).selectOption("reviewed");
await page.getByRole("status").getByText("Report status updated.").waitFor();
await moderatedComment.getByRole("button", { name: "Delete" }).click();
await page.getByRole("status").getByText("Comment deleted.").waitFor();
assert.ok(confirmedDialogs.some((message) => /delete this comment/i.test(message)), "admin comment deletion must ask for explicit confirmation");
assert.equal(ok(await commentApi(titleDiscussionPath)).count, 1, "admin deletion must cascade through the original comment thread");
assert.ok(!(await ok(await api("/api/admin/comments?status=")).some((report) => report.commentId === spoilerComment.id)), "deleting a comment should remove its reports from moderation");
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
// Guided movie creation: real poster/video multipart uploads to the local R2 mock.
await page.getByRole("button", { name: "+ Add media" }).click();
await page.getByLabel("Title", { exact: true }).fill(`Wizard Movie ${run}`);
await page.locator('input[type="file"]').setInputFiles({ name: "wizard-poster.png", mimeType: "image/png", buffer: png });
await page.waitForFunction(() => document.querySelector('input[placeholder="https://…"]')?.value.startsWith("/api/image?"));
await page.getByRole("button", { name: "Next", exact: true }).click();
await page.getByLabel("Download link 1", { exact: true }).fill("https://example.com/wizard-1080");
await page.getByRole("button", { name: "+ Another quality / link", exact: true }).click();
await page.getByLabel("Download link 2", { exact: true }).fill("https://example.com/wizard-720");
await page.getByRole("button", { name: "Save movie", exact: true }).click();
await page.getByRole("button", { name: "Edit details", exact: true }).waitFor();
const wizardMovie = (await pool.query("SELECT id,poster_url FROM media WHERE title=$1", [`Wizard Movie ${run}`])).rows[0];
assert.ok(wizardMovie.poster_url.startsWith("/api/image?"), "wizard poster stays private via image handler");
const movieUploadForm = page.getByRole("form", { name: "Download link form movie", exact: true });
await movieUploadForm.locator("select").selectOption("2160p");
await movieUploadForm.locator('input[type="file"]').setInputFiles({ name: "wizard-movie-2160.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 6) });
await page.getByText(/Uploaded and verified in R2/).waitFor();
await movieUploadForm.getByRole("button", { name: "Add link", exact: true }).click();
await page.getByText("Cloudflare R2", { exact: true }).first().waitFor();
await page.getByRole("button", { name: "Edit details", exact: true }).click();
await page.getByLabel("Title", { exact: true }).fill(`Edited Wizard Movie ${run}`);
await page.getByRole("button", { name: "Save Changes", exact: true }).click();
await page.getByRole("heading", { name: new RegExp(`Edited Wizard Movie ${run}`) }).waitFor();
const savedWizardMovie = ok(await api(`/api/media/${wizardMovie.id}`));
assert.equal(savedWizardMovie.posterUrl, wizardMovie.poster_url);
assert.deepEqual(new Set(savedWizardMovie.downloadLinks.map((link) => link.quality)), new Set(["720p", "1080p", "2160p"]));
assert.equal(savedWizardMovie.downloadLinks.filter((link) => link.storageProvider === "r2").length, 1);
await page.getByRole("button", { name: "← Back to media", exact: true }).click();
await page.getByRole("button", { name: "+ Add media" }).click();
await page.getByLabel("Type").selectOption("anime");
await page.getByLabel("Title", { exact: true }).fill(`Browser Anime ${run}`);
await page.getByRole("button", { name: "Next", exact: true }).click();
await page.getByLabel("First season #", { exact: true }).fill("1");
await page.getByRole("button", { name: "Create & Continue" }).click();
await page.getByText("Individual editing & files", { exact: true }).click();
const individualEditor = page.getByTestId("individual-episode-editor");
await individualEditor.getByRole("button", { name: /Season 1/ }).click();
await page.getByText("Create a complete season").waitFor();
await page.getByLabel("Count").fill("3");
await individualEditor.getByRole("button", { name: "Create episodes", exact: true }).click();
await individualEditor.getByText("Episode 1", { exact: true }).waitFor();
// A single batch may contain multiple qualities for the same episode.
await page.locator('input[type="file"][multiple]').setInputFiles([
  { name: "S01E01-720p.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 4) },
  { name: "S01E01-1080p.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048, 5) },
]);
await page.getByText("S01E01-720p.mp4").waitFor();
await page.getByText("S01E01-720p.mp4").locator("..").locator("select").selectOption("720p");
await page.getByRole("button", { name: "Upload / retry batch" }).click();
await page.getByText("2 files uploaded and attached. Failed rows can be retried without re-uploading completed files.").waitFor({ timeout: 60000 });
await individualEditor.getByText("Episode 1", { exact: true }).click();
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
// Dedicated bulk creation: validation, duplicate numbers, partial failure/retry, and real multi-file R2 upload.
const bulkTitle = ok(await api("/api/media", { method: "POST", body: { type: "anime", title: `Bulk UI Anime ${run}` } }), 201);
const bulkSeason = ok(await api("/api/seasons", { method: "POST", body: { mediaId: bulkTitle.id, seasonNumber: 1 } }), 201);
await page.goto(`${base}/admin`);
await page.getByRole("button", { name: "File batches", exact: true }).click();
await page.getByLabel("Bulk anime or series").selectOption(String(bulkTitle.id));
await page.getByLabel("Bulk season").selectOption(String(bulkSeason.id));
const bulkRows = page.getByTestId("bulk-episode-row");
await page.getByRole("button", { name: "Add Another Episode" }).click();
await page.getByRole("button", { name: "Save all episodes" }).click();
await page.getByText("Review the highlighted rows. Nothing new was submitted.").waitFor();
assert.equal(ok(await api(`/api/media/${bulkTitle.id}`)).seasons[0].episodes.length, 0);
await bulkRows.nth(0).getByLabel("Episode title", { exact: true }).fill("Bulk one");
await bulkRows.nth(0).getByLabel("Episode download link").fill("https://example.com/bulk-one.mp4");
await page.getByRole("button", { name: "Add Another Episode" }).click();
await bulkRows.nth(1).getByLabel("Episode number", { exact: true }).fill("1");
await bulkRows.nth(1).getByLabel("Episode title", { exact: true }).fill("Bulk two");
await bulkRows.nth(1).getByLabel("Episode download link").fill("https://example.com/bulk-two.mp4");
await page.getByRole("button", { name: "Retry failed episodes" }).click();
await page.getByText("Duplicate episode number in this batch.").first().waitFor();
assert.equal(ok(await api(`/api/media/${bulkTitle.id}`)).seasons[0].episodes.length, 0);
await bulkRows.nth(1).getByLabel("Episode number", { exact: true }).fill("2");
let failBulkLink = true;
await page.route('**/api/download-links', async (route) => {
  if (route.request().method() === 'POST' && route.request().postDataJSON()?.url === 'https://example.com/bulk-two.mp4' && failBulkLink) {
    failBulkLink = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated link failure' }) });
  }
  return route.continue();
});
await page.getByRole("button", { name: "Retry failed episodes" }).click();
await page.getByText('1 / 2 saved · 1 failed', { exact: true }).waitFor();
assert.equal(ok(await api(`/api/media/${bulkTitle.id}`)).seasons[0].episodes.length, 2, 'partial failure retains created episodes');
await page.getByRole("button", { name: "Retry failed episodes" }).click();
await page.getByText('2 / 2 saved · 0 failed', { exact: true }).waitFor();
let bulkDetails = ok(await api(`/api/media/${bulkTitle.id}`));
assert.equal(bulkDetails.seasons[0].episodes.length, 2);
assert.ok(bulkDetails.seasons[0].episodes.every((episode) => episode.downloadLinks.length === 1), 'retry must not duplicate successful episodes or links');
await page.unroute('**/api/download-links');
await page.getByLabel('Bulk video files').setInputFiles([
  { name: 'S01E03.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 3) },
  { name: 'S01E04.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 4) },
]);
assert.equal(await bulkRows.nth(2).getByLabel('Episode number', { exact: true }).inputValue(), '3');
await page.getByRole("button", { name: "Save all episodes" }).click();
await page.getByText('4 / 4 saved · 0 failed', { exact: true }).waitFor({ timeout: 60000 });
bulkDetails = ok(await api(`/api/media/${bulkTitle.id}`));
assert.equal(bulkDetails.seasons[0].episodes.length, 4);
assert.ok(bulkDetails.seasons[0].episodes.slice(2).every((episode) => episode.downloadLinks.length === 1 && episode.downloadLinks[0].storageProvider === 'r2'));
await page.getByRole("button", { name: "Add Another Episode" }).click();
await page.getByRole('button', { name: 'Remove entry 5', exact: true }).click();
assert.equal(await bulkRows.count(), 4);
await page.getByRole('button', { name: /^media$/i }).click();
await page.getByRole('button', { name: 'File batches', exact: true }).click();
assert.equal(await bulkRows.count(), 4, 'admin tab switches retain bulk retry checkpoints');
for (const width of [360, 390, 768, 1280]) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `bulk admin fits at ${width}px`);
}
// Inclusive ranges and a separate quality batch operate only on existing placeholders.
const qualityTitle = ok(await api("/api/media", { method: "POST", body: { type: "series", title: `Quality series ${run}` } }), 201);
const qualitySeason = ok(await api("/api/seasons", { method: "POST", body: { mediaId: qualityTitle.id, seasonNumber: 1 } }), 201);
const largeQualitySeason = ok(await api("/api/seasons", { method: "POST", body: { mediaId: qualityTitle.id, seasonNumber: 2 } }), 201);
await page.goto(`${base}/admin`);
await page.getByRole("button", { name: "Episodes", exact: true }).click();
await page.getByLabel("Link batch anime or series").selectOption(String(qualityTitle.id));
await page.getByLabel("Link batch season").selectOption(String(qualitySeason.id));
await page.getByRole("button", { name: "Create Episodes", exact: true }).click();
await page.getByText("Created Episodes 1–12. Add links below; no links or other qualities were changed.", { exact: true }).waitFor();
assert.equal(await page.getByTestId("quality-link-row").count(), 12);
await page.getByLabel("Start episode", { exact: true }).fill("13");
await page.getByLabel("End episode", { exact: true }).fill("100");
await page.getByRole("button", { name: "Create Episodes", exact: true }).click();
await page.getByText("Created Episodes 13–100. Add links below; no links or other qualities were changed.", { exact: true }).waitFor();
assert.equal(await page.getByTestId("quality-link-row").count(), 100);
let qualityDetails = ok(await api(`/api/media/${qualityTitle.id}`));
const originalEpisodeIds = qualityDetails.seasons[0].episodes.map((episode) => episode.id);
await page.getByLabel("Start episode", { exact: true }).fill("1");
await page.getByLabel("End episode", { exact: true }).fill("12");
await page.getByRole("button", { name: "Create Episodes", exact: true }).click();
await page.getByRole("alert").getByText(/Episode numbers already exist/).waitFor();
assert.equal(ok(await api(`/api/media/${qualityTitle.id}`)).seasons[0].episodes.length, 100, 'overlapping range never duplicates placeholders');
for (let number = 1; number <= 3; number++) await page.getByLabel(`Link for episode ${number}`, { exact: true }).fill(`https://example.com/quality-${number}-720.mp4`);
let failQualityLink = true;
await page.route('**/api/download-links', async (route) => {
  if (route.request().method() === 'POST' && route.request().postDataJSON()?.url === 'https://example.com/quality-2-720.mp4' && failQualityLink) {
    failQualityLink = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Quality link temporary failure' }) });
  }
  return route.continue();
});
await page.getByRole("button", { name: "Save All", exact: true }).click();
await page.getByText("2 saved · 1 failed · 0 existing qualities skipped. Other qualities were not changed.", { exact: true }).waitFor();
await page.getByRole("button", { name: "Save All", exact: true }).click();
await page.getByText("1 saved · 0 failed · 0 existing qualities skipped. Other qualities were not changed.", { exact: true }).waitFor();
await page.unroute('**/api/download-links');
await page.getByLabel("Batch link quality").selectOption("1080p");
for (let number = 1; number <= 3; number++) await page.getByLabel(`Link for episode ${number}`, { exact: true }).fill(`https://example.com/quality-${number}-1080.mp4`);
await page.getByRole("button", { name: "Save All", exact: true }).click();
await page.getByText("3 saved · 0 failed · 0 existing qualities skipped. Other qualities were not changed.", { exact: true }).waitFor();
qualityDetails = ok(await api(`/api/media/${qualityTitle.id}`));
assert.deepEqual(qualityDetails.seasons[0].episodes.map((episode) => episode.id), originalEpisodeIds, 'quality batches never recreate episodes');
for (const episode of qualityDetails.seasons[0].episodes.slice(0, 3)) {
  assert.deepEqual(new Set(episode.downloadLinks.map((link) => link.quality)), new Set(['720p', '1080p']));
  assert.equal(episode.downloadLinks.length, 2, 'both quality links retained with no duplicate retries');
}
await page.getByLabel("Batch link quality").selectOption("720p");
assert.equal(await page.getByLabel("Link for episode 1", { exact: true }).isDisabled(), true, 'saved quality cannot be overwritten in bulk UI');
await page.getByLabel("Link for episode 4", { exact: true }).fill('https://example.com/proposed-change.mp4');
const episodeFour = qualityDetails.seasons[0].episodes[3];
ok(await api('/api/download-links', { method: 'POST', body: { mediaId: qualityTitle.id, seasonId: qualitySeason.id, episodeId: episodeFour.id, quality: '720p', url: 'https://example.com/existing-protected.mp4' } }), 201);
await page.getByRole("button", { name: "Save All", exact: true }).click();
await page.getByText("0 saved · 0 failed · 1 existing qualities skipped. Other qualities were not changed.", { exact: true }).waitFor();
qualityDetails = ok(await api(`/api/media/${qualityTitle.id}`));
assert.deepEqual(qualityDetails.seasons[0].episodes[3].downloadLinks.map((link) => link.url), ['https://example.com/existing-protected.mp4']);
await page.getByLabel("Link for episode 5", { exact: true }).fill('javascript:alert(1)');
await page.getByRole("button", { name: "Save All", exact: true }).click();
await page.getByRole("alert").getByText("Fix the invalid links before saving. Nothing new was submitted.").waitFor();
assert.equal(ok(await api(`/api/media/${qualityTitle.id}`)).seasons[0].episodes[4].downloadLinks.length, 0);
for (const width of [360, 390, 768, 1280]) {
  await page.setViewportSize({ width, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `quality link workflow fits at ${width}px`);
}
await page.getByLabel("Link batch season").selectOption(String(largeQualitySeason.id));
await page.getByLabel("Start episode", { exact: true }).fill("1");
await page.getByLabel("End episode", { exact: true }).fill("100");
await page.getByRole("button", { name: "Create Episodes", exact: true }).click();
await page.getByText("Created Episodes 1–100. Add links below; no links or other qualities were changed.", { exact: true }).waitFor();
const finalQualityDetails = ok(await api(`/api/media/${qualityTitle.id}`));
assert.equal(finalQualityDetails.seasons.find((season) => season.id === largeQualitySeason.id).episodes.length, 100);
assert.deepEqual(finalQualityDetails.seasons[0].episodes.map((episode) => episode.id), originalEpisodeIds);
assert.deepEqual(errors, []);
await browser.close();

// Existing records are still present; migrations are additive.
const after = await pool.query("SELECT (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM download_links) AS links");
assert.ok(Number(after.rows[0].media) >= Number(before.rows[0].media));
const legacyStill = await pool.query("SELECT url FROM download_links WHERE media_id=$1 AND url='/uploads/videos/legacy.mp4'", [legacyMovie.id]);
assert.equal(legacyStill.rowCount, 1);
await pool.end();
console.log("E2E passed: desktop/mobile Smart Search layout, aliases/typos/filters and episode deep links; anonymous title/episode comments, unlimited nested replies with inline composers, icon-only action bars with labels/tooltips and conditional-year compact timestamps, deep-thread spoilers/likes/reports, hidden-ancestor moderation, idempotent likes, rate-limited validation, admin review/hide/restore/confirmed delete and comment toggles; responsive nested comment UI; combined library filters; auth/contact rate limits/CSRF and Resend/Admin Requests; legacy media, PWA-sensitive routes, R2 uploads/downloads, seasons/episodes/bulk links, object retention, and URL/poster security.");
