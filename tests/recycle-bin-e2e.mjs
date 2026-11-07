// Disposable PostgreSQL + local mock R2 ONLY. Never target a live deployment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
for (const url of [base, dbUrl, process.env.R2_ENDPOINT]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Recycle tests refuse remote targets");
const pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
function client(ip) {
  let cookies = "";
  return async (url, method = "GET", body) => {
    const response = await fetch(`${base}${url}`, { method, headers: { "x-e2e-client-ip": ip, ...(cookies ? { Cookie: cookies } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) { const entry = cookie.split(";")[0], key = entry.split("=")[0]; cookies = [...cookies.split("; ").filter((old) => old && !old.startsWith(`${key}=`)), entry].join("; "); }
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { response, data };
  };
}
const admin = client("198.51.100.224"), anon = client("198.51.100.225");
const ok = (result, status = 200) => { assert.equal(result.response.status, status, `${result.response.url}: ${JSON.stringify(result.data)}`); return result.data; };
const key = `recycle-${randomUUID().slice(0, 12)}`;
const restore = async (kind, id) => ok(await admin("/api/admin/recycle-bin", "POST", { action: "restore", kind, id }));
let browser;
try {
  ok(await admin("/api/auth/login", "POST", { password: process.env.E2E_ADMIN_PASSWORD || "test-admin-password" }));
  assert.equal((await anon("/api/admin/recycle-bin")).response.status, 401);
  assert.equal((await anon("/api/admin/recycle-bin", "POST", { action: "empty", confirmation: "EMPTY RECYCLE BIN" })).response.status, 401);
  const title = ok(await admin("/api/media", "POST", { type: "series", title: key }), 201);
  const season = ok(await admin("/api/seasons", "POST", { mediaId: title.id, seasonNumber: 1 }), 201);
  ok(await admin("/api/episodes/batch", "POST", { seasonId: season.id, start: 1, count: 22 }), 201);
  const details = ok(await admin(`/api/media/${title.id}`));
  const ids = details.seasons[0].episodes.map((episode) => episode.id), episode = ids[12];
  const external = ok(await admin("/api/download-links", "POST", { mediaId: title.id, seasonId: season.id, episodeId: episode, quality: "720p", url: "https://example.com/recover-me" }), 201);
  // A real multipart object in the local S3-compatible provider mock.
  const bytes = Buffer.alloc(6 * 1024 * 1024, 13);
  const upload = ok(await admin("/api/uploads", "POST", { kind: "video", fileName: "recycle-private.mp4", contentType: "video/mp4", sizeBytes: bytes.length, mediaId: title.id, seasonId: season.id, episodeId: ids[13], quality: "1080p" }), 201);
  for (const part of upload.parts) {
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(part.url).hostname));
    const start = (part.partNumber - 1) * upload.partSizeBytes;
    const response = await fetch(part.url, { method: "PUT", headers: part.headers, body: bytes.subarray(start, Math.min(start + upload.partSizeBytes, bytes.length)) });
    assert.equal(response.status, 200);
  }
  const completed = ok(await admin(`/api/uploads/${upload.id}/complete`, "POST"));
  const privateLink = ok(await admin("/api/download-links", "POST", { mediaId: title.id, seasonId: season.id, episodeId: ids[13], quality: "1080p", r2UploadId: completed.id }), 201);
  const signed = await fetch(`${base}/api/download?id=${privateLink.id}`, { redirect: "manual" });
  assert.equal(signed.status, 302); const objectUrl = signed.headers.get("location");
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(objectUrl).hostname));
  assert.deepEqual(Buffer.from(await (await fetch(objectUrl)).arrayBuffer()), bytes);
  const object = new URL(objectUrl); assert.equal((await fetch(`${object.origin}${object.pathname}`)).status, 403, "private object still requires signature");
  ok(await anon("/api/updates")); ok(await anon("/api/follows", "POST", { mediaId: title.id }));
  const comment = ok(await anon("/api/comments", "POST", { mediaId: title.id, episodeId: episode, body: "Preserve this root comment" }), 201);
  // Comment response shape is covered in the existing suite; seed a deep chain
  // here so restoration checks all dependent FK rows without session limits.
  const root = (await pool.query("SELECT id FROM comments WHERE media_id=$1 AND episode_id=$2 ORDER BY id DESC LIMIT 1", [title.id, episode])).rows[0];
  assert.ok(comment); let parent = root.id;
  for (let i = 0; i < 10; i++) parent = (await pool.query("INSERT INTO comments(media_id,episode_id,parent_id,author_hash,body) VALUES ($1,$2,$3,$4,$5) RETURNING id", [title.id, episode, parent, "a".repeat(64), `Nested ${i}`])).rows[0].id;
  await pool.query("INSERT INTO comment_likes(comment_id,session_hash) VALUES ($1,$2)", [parent, "b".repeat(64)]);
  await pool.query("INSERT INTO comment_reports(comment_id,reporter_hash,reason) VALUES ($1,$2,'spam')", [parent, "c".repeat(64)]);
  const counts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM episodes WHERE media_id=$1) AS episodes,(SELECT count(*)::int FROM download_links WHERE media_id=$1) AS links,(SELECT count(*)::int FROM comments WHERE media_id=$1) AS comments,(SELECT count(*)::int FROM anime_follows WHERE media_id=$1) AS follows`, [title.id])).rows[0];
  const subscriber = (await pool.query("SELECT subscriber_id FROM anime_follows WHERE media_id=$1", [title.id])).rows[0].subscriber_id;
  await pool.query("INSERT INTO episode_notifications(subscriber_id,episode_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [subscriber, episode]);
  const notificationId = (await pool.query("SELECT id FROM episode_notifications WHERE subscriber_id=$1 AND episode_id=$2", [subscriber, episode])).rows[0].id;
  const before = await counts(); assert.deepEqual(before, { episodes: 22, links: 2, comments: 11, follows: 1 });
  // Browser: correct 1–22 to 1–12 by selecting 13–22; no season recreation.
  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br")); setupLambdaEnvironment("/tmp/al2023/lib");
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.226" } });
  const page = await context.newPage(); const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.type() === "confirm" ? dialog.accept() : dialog.dismiss());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  // Login UI uses the same configured synthetic password.
  if (await page.getByPlaceholder("Password", { exact: true }).count()) {
    await page.getByPlaceholder("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD || "test-admin-password");
    await page.getByRole("button", { name: /Log in|Sign in/i }).click();
  }
  await page.getByRole("button", { name: "Episodes", exact: true }).click();
  await page.getByLabel("Link batch anime or series").selectOption(String(title.id));
  await page.getByLabel("Link batch season").selectOption(String(season.id));
  await page.getByText("Select episode range to delete", { exact: true }).click();
  await page.getByLabel("Delete range start").fill("13"); await page.getByLabel("Delete range end").fill("22");
  await page.getByRole("button", { name: "Select range", exact: true }).click();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await page.getByText("Episodes moved to the Recycle Bin. Their links, comments and R2 files were retained.", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("quality-link-row").count(), 12);
  assert.deepEqual(await counts(), before, "soft deletion preserves all original rows and relationships");
  assert.ok(!ok(await anon("/api/updates")).notifications.some((item) => item.id === notificationId), "trashed episode alerts hidden, not erased");
  assert.equal((await anon(`/api/download?id=${external.id}`)).response.status, 404);
  assert.equal((await anon(`/api/download?id=${privateLink.id}`)).response.status, 404);
  assert.equal((await anon(`/api/comments?mediaId=${title.id}&episodeId=${episode}`)).response.status, 404);
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click();
  await page.getByRole("button", { name: `${key} 10 deleted episodes`, exact: true }).click();
  await page.getByRole("button", { name: "Season 1 10 deleted", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^Restore ${key}.*Episode 13(?: ·|$)`) }).click();
  await page.getByText(/Restored. Independently deleted children/).waitFor();
  await page.getByRole("button", { name: `Restore all deleted episodes in ${key}, Season 1`, exact: true }).click();
  await page.getByText("Restored 9 episodes. Other seasons and independently deleted items were not changed.", { exact: true }).waitFor();
  assert.deepEqual(ok(await admin(`/api/media/${title.id}`)).seasons[0].episodes.map((entry) => entry.id), ids);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM comment_likes WHERE comment_id=$1", [parent])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM comment_reports WHERE comment_id=$1", [parent])).rows[0].n, 1);
  // Single and all episode delete options are also reversible.
  await page.getByRole("button", { name: "Episodes", exact: true }).click();
  await page.getByLabel("Link batch anime or series").selectOption(String(title.id));
  await page.getByLabel("Link batch season").selectOption(String(season.id));
  await page.getByRole("button", { name: "Refresh season", exact: true }).click();
  await page.getByRole("button", { name: "Delete episode 13", exact: true }).click();
  await page.getByText("Episodes moved to the Recycle Bin. Their links, comments and R2 files were retained.", { exact: true }).waitFor();
  await restore("episode", episode);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/episodes/batch") && response.request().method() === "DELETE" && response.status() === 200), page.getByRole("button", { name: "Delete All Episodes", exact: true }).click()]);
  assert.equal(ok(await admin(`/api/media/${title.id}`)).seasons[0].episodes.length, 0);
  assert.deepEqual(await counts(), before);
  for (const id of ids) await restore("episode", id);
  // Parent restore restores its subtree but never independently deleted items.
  ok(await admin(`/api/episodes/${ids[21]}`, "DELETE"));
  ok(await admin(`/api/seasons/${season.id}`, "DELETE"));
  assert.equal((await admin("/api/admin/recycle-bin", "POST", { action: "restore", kind: "episode", id: ids[21] })).response.status, 409);
  assert.equal(ok(await admin(`/api/media/${title.id}`)).seasons.length, 0);
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click();
  await page.getByRole("button", { name: `${key} 1 deleted episode`, exact: true }).click();
  await page.getByRole("button", { name: "Season 1 1 deleted", exact: true }).click();
  const restoreSeasonEpisodes = page.getByRole("button", { name: `Restore all deleted episodes in ${key}, Season 1`, exact: true });
  assert.equal(await restoreSeasonEpisodes.isDisabled(), true, "UI respects deleted parent season");
  await restore("season", season.id);
  await page.getByRole("button", { name: "Refresh bin", exact: true }).click();
  await page.waitForFunction(() => { const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent === "Restore All"); return button && !button.disabled; });
  assert.equal(ok(await admin(`/api/media/${title.id}`)).seasons[0].episodes.length, 21);
  ok(await admin(`/api/media/${title.id}`, "DELETE"));
  assert.equal((await anon(`/api/media/${title.id}`)).response.status, 404);
  assert.ok(!ok(await anon("/api/media")).some((item) => item.id === title.id));
  assert.ok(!ok(await anon("/api/updates")).following.some((item) => item.id === title.id));
  assert.equal((await admin("/api/admin/recycle-bin", "POST", { action: "restore", kind: "season", id: season.id })).response.status, 409);
  await restore("media", title.id); await restore("episode", ids[21]);
  assert.deepEqual(await counts(), before);
  assert.ok(ok(await anon("/api/updates")).following.some((item) => item.id === title.id));
  assert.ok(ok(await anon("/api/updates")).notifications.some((item) => item.id === notificationId), "restore recovers same notification without duplication");
  // Movie classification is explicit; never guess or reclassify existing media.
  const animeMovie = ok(await admin("/api/media", "POST", { type: "movie", isAnimeMovie: true, title: `${key}-anime-movie` }), 201);
  const liveMovie = ok(await admin("/api/media", "POST", { type: "movie", title: `${key}-live-movie` }), 201);
  assert.ok(!ok(await anon("/api/media?type=movie")).some((item) => item.id === animeMovie.id));
  assert.ok(ok(await anon("/api/media?type=movie&animeMovie=true")).some((item) => item.id === animeMovie.id));
  const animeMoviePage = await fetch(`${base}/anime?format=movie`); assert.equal(animeMoviePage.status, 200); assert.ok((await animeMoviePage.text()).includes(animeMovie.title));
  assert.equal((await admin("/api/seasons", "POST", { mediaId: animeMovie.id, seasonNumber: 1 })).response.status, 400);
  for (const item of [animeMovie, liveMovie]) { ok(await admin(`/api/media/${item.id}`, "DELETE")); await restore("media", item.id); assert.equal(ok(await admin(`/api/media/${item.id}`)).id, item.id); }
  const anime = ok(await admin("/api/media", "POST", { type: "anime", title: `${key}-anime` }), 201);
  const largeSeason = ok(await admin("/api/seasons", "POST", { mediaId: anime.id, seasonNumber: 1 }), 201);
  ok(await admin("/api/episodes/batch", "POST", { seasonId: largeSeason.id, start: 1, count: 500 }), 201);
  ok(await admin("/api/episodes/batch", "POST", { seasonId: largeSeason.id, start: 501, count: 11 }), 201);
  const foreignId = ok(await admin(`/api/media/${anime.id}`)).seasons[0].episodes[0].id;
  assert.equal((await admin("/api/episodes/batch", "DELETE", { seasonId: season.id, ids: [ids[0], foreignId] })).response.status, 400);
  assert.equal(ok(await admin(`/api/media/${title.id}`)).seasons[0].episodes.length, 22, "cross-season selection moves nothing");
  ok(await admin("/api/episodes/batch", "DELETE", { seasonId: largeSeason.id, all: true, confirmation: "MOVE ALL EPISODES" }));
  assert.equal(ok(await admin(`/api/media/${anime.id}`)).seasons[0].episodes.length, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM episodes WHERE season_id=$1", [largeSeason.id])).rows[0].n, 511, "large-season delete is recoverable without a 500-item truncation");
  ok(await admin(`/api/media/${anime.id}`, "DELETE")); await restore("media", anime.id);
  assert.equal(ok(await admin(`/api/media/${anime.id}`)).seasons[0].episodes.length, 0, "parent restore does not revive independently trashed 511 episodes");
  // Purge is a separate, guarded operation; R2 is retained even after FK cleanup.
  assert.equal((await admin("/api/admin/recycle-bin", "POST", { action: "purge", kind: "media", id: title.id, confirmation: `DELETE PERMANENTLY media:${title.id}` })).response.status, 409);
  ok(await admin(`/api/media/${title.id}`, "DELETE"));
  assert.equal((await admin("/api/admin/recycle-bin", "POST", { action: "purge", kind: "media", id: title.id, confirmation: "yes" })).response.status, 400);
  assert.deepEqual(await counts(), before);
  ok(await admin("/api/admin/recycle-bin", "POST", { action: "purge", kind: "media", id: title.id, confirmation: `DELETE PERMANENTLY media:${title.id}` }));
  assert.deepEqual(await counts(), { episodes: 0, links: 0, comments: 0, follows: 0 });
  assert.equal((await pool.query("SELECT status FROM r2_uploads WHERE id=$1", [completed.id])).rows[0].status, "completed");
  assert.deepEqual(Buffer.from(await (await fetch(objectUrl)).arrayBuffer()), bytes, "physical R2 object survives permanent DB deletion");
  for (const item of [animeMovie, liveMovie, anime]) ok(await admin(`/api/media/${item.id}`, "DELETE"));
  assert.equal((await admin("/api/admin/recycle-bin", "POST", { action: "empty", confirmation: "yes" })).response.status, 400);
  ok(await admin("/api/admin/recycle-bin", "POST", { action: "empty", confirmation: "EMPTY RECYCLE BIN" }));
  assert.equal(ok(await admin("/api/admin/recycle-bin")).total, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM media WHERE id=ANY($1::int[])", [[animeMovie.id, liveMovie.id, anime.id]])).rows[0].n, 0);
  await page.getByRole("button", { name: "Refresh bin", exact: true }).click();
  await page.getByText("Recycle Bin is empty.", { exact: true }).waitFor();
  for (const width of [320, 360, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
  assert.deepEqual(pageErrors, []);
  console.log("Recycle E2E PASS: 13–22 correction, single/selected/all deletion, parent/child restore, original IDs/links/11 comment levels/likes/reports/follows preserved, purge/empty confirmations, actual private multipart mock R2 object and audit retained, anime-movie classification isolated from regular Movies.");
} finally { await browser?.close(); await pool.end(); }
