// Real built Admin UI + in-memory API fixtures. No database or provider access.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

let nextId = 1, failLink = false;
const items = [], writes = [], unexpected = [], external = [], errors = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture.test");
  const json = (data, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
  let body = {};
  try {
    if (["POST", "PATCH"].includes(req.method)) { let raw = ""; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; writes.push({ path: url.pathname, body }); }
    if (url.pathname === "/api/site-settings") return json({ wallpaperUrl: null, wallpaperOverlay: 65, wallpaperBlur: 0 });
    if (url.pathname === "/api/auth/session") return json({ authed: true });
    if (url.pathname === "/api/categories") return json([{ id: 1, name: "Action", slug: "action" }]);
    if (url.pathname === "/api/storage/status") return json({ configured: false, missing: ["test R2 configuration"], maxVideoBytes: 100000, maxImageBytes: 100000, partSizeBytes: 5242880, privateDownloads: true });
    if (url.pathname === "/api/updates") return json({ following: [], notifications: [], unread: 0 });
    if (url.pathname === "/api/media") {
      if (req.method === "POST") { const item = { ...body, id: nextId++, slug: `fixture-${nextId}`, seasons: [], downloadLinks: [], commentsEnabled: true }; items.push(item); return json(item, 201); }
      return json(items);
    }
    const match = url.pathname.match(/^\/api\/media\/(\d+)$/);
    if (match) { const item = items.find((entry) => entry.id === Number(match[1])); if (!item) return json({ error: "Not found" }, 404); if (req.method === "PATCH") Object.assign(item, body); return json(item); }
    if (url.pathname === "/api/seasons") {
      const item = items.find((entry) => entry.id === body.mediaId);
      if (item.seasons.some((entry) => entry.seasonNumber === body.seasonNumber)) return json({ error: "Season number already exists" }, 409);
      const season = { ...body, id: nextId++, episodes: [], downloadLinks: [] }; item.seasons.push(season); return json(season, 201);
    }
    if (url.pathname === "/api/episodes/batch") {
      const season = items.flatMap((item) => item.seasons).find((entry) => entry.id === body.seasonId);
      const numbers = Array.from({ length: body.count }, (_, index) => body.start + index);
      if (season.episodes.some((episode) => numbers.includes(episode.episodeNumber))) return json({ error: "Episode numbers already exist" }, 409);
      const episodes = numbers.map((number) => ({ id: nextId++, episodeNumber: number, title: `Episode ${number}`, downloadLinks: [] })); season.episodes.push(...episodes); return json(episodes, 201);
    }
    if (url.pathname === "/api/download-links") {
      if (failLink) { failLink = false; return json({ error: "Fixture temporary failure" }, 503); }
      const item = items.find((entry) => entry.id === body.mediaId), link = { ...body, id: nextId++ };
      const episode = item.seasons.flatMap((season) => season.episodes).find((entry) => entry.id === body.episodeId);
      (episode ? episode.downloadLinks : item.downloadLinks).push(link); return json(link, 201);
    }
    if (url.pathname.startsWith("/api/")) { unexpected.push(url.pathname); return json({ error: "Unexpected fixture API" }, 404); }
    let file;
    if (url.pathname === "/admin" || url.pathname === "/") file = ".next/server/app/admin.html";
    else if (url.pathname.startsWith("/_next/static/")) file = `.next/static/${url.pathname.slice(14)}`;
    else if (["/sw.js", "/manifest.webmanifest", "/offline.html"].includes(url.pathname) || url.pathname.startsWith("/icons/")) file = `public${url.pathname}`;
    else { res.statusCode = 404; return res.end(); }
    const resolved = path.resolve(file);
    assert.ok(resolved.startsWith(`${process.cwd()}/.next/`) || resolved.startsWith(`${process.cwd()}/public/`));
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(resolved));
  } catch (error) { errors.push(String(error)); json({ error: "Fixture server error" }, 500); }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br")); setupLambdaEnvironment("/tmp/al2023/lib");
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", (route) => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  const assertFits = async (screen) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${screen} fits at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  };
  const create = async (type, title) => {
    await page.getByRole("button", { name: "+ Add media", exact: true }).click();
    await page.getByLabel("Type", { exact: true }).selectOption(type);
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Year", { exact: true }).fill("2026");
    await assertFits("basic details");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await assertFits("poster step");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), title);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await assertFits("final setup step");
  };
  await create("movie", "Wizard movie");
  await page.getByLabel("Download link 1", { exact: true }).fill("javascript:bad");
  await page.getByRole("button", { name: "Save movie", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Use HTTP(S)" }).waitFor(); assert.equal(items.length, 0, "invalid links cannot create a title");
  await page.getByLabel("Download link 1", { exact: true }).fill("https://example.com/movie-1080");
  failLink = true;
  await page.getByRole("button", { name: "Save movie", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture temporary failure" }).waitFor();
  assert.equal(items.length, 1);
  await page.getByRole("button", { name: "Retry setup", exact: true }).click();
  await page.getByRole("button", { name: "Edit details", exact: true }).waitFor();
  assert.equal(items.length, 1, "retry does not recreate the movie"); assert.equal(items[0].downloadLinks.length, 1);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Edited wizard movie");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByRole("heading", { name: /Edited wizard movie/ }).waitFor();
  await page.getByRole("button", { name: "← Back to media", exact: true }).click();
  for (const type of ["anime", "series"]) {
    await create(type, `Wizard ${type}`);
    await page.getByRole("button", { name: "Create & Continue", exact: true }).click();
    await page.getByLabel("Link batch season", { exact: true }).waitFor();
    assert.equal(items.at(-1).seasons.length, 1);
    await page.getByRole("button", { name: "← Back to media", exact: true }).click();
  }
  await page.getByRole("button", { name: "Episodes", exact: true }).click();
  const series = items.find((item) => item.type === "series");
  await page.getByLabel("Link batch anime or series").selectOption(String(series.id));
  await page.getByText("+ Create a season", { exact: true }).click();
  await page.getByLabel("New season number").fill("2");
  await page.getByRole("button", { name: "Create season", exact: true }).click();
  await page.getByText("Season created. Enter the episode range below.", { exact: true }).waitFor();
  await page.getByLabel("End episode", { exact: true }).fill("24");
  await page.getByRole("button", { name: "Create Episodes", exact: true }).click();
  await page.getByText("Created Episodes 1–24. Add links below; no links or other qualities were changed.", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("quality-link-row").count(), 24);
  await page.getByRole("button", { name: "Create Episodes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Episode numbers already exist" }).waitFor();
  assert.equal(series.seasons[1].episodes.length, 24);
  const ids = series.seasons[1].episodes.map((episode) => episode.id);
  for (const quality of ["720p", "1080p"]) {
    await page.getByLabel("Batch link quality").selectOption(quality);
    await page.getByLabel("Link for episode 1", { exact: true }).fill(`https://example.com/episode1-${quality}`);
    if (quality === "720p") failLink = true;
    await page.getByRole("button", { name: "Save All", exact: true }).click();
    if (quality === "720p") {
      await page.getByText("0 saved · 1 failed · 0 existing qualities skipped. Other qualities were not changed.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Save All", exact: true }).click();
    }
    await page.getByText("1 saved · 0 failed · 0 existing qualities skipped. Other qualities were not changed.", { exact: true }).waitFor();
  }
  assert.deepEqual(series.seasons[1].episodes.map((episode) => episode.id), ids);
  assert.deepEqual(series.seasons[1].episodes[0].downloadLinks.map((link) => link.quality), ["720p", "1080p"]);
  await page.getByLabel("Batch link quality").selectOption("720p");
  assert.equal(await page.getByLabel("Link for episode 1", { exact: true }).isDisabled(), true);
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `episode workspace fits at ${width}`);
  }
  await page.getByRole("button", { name: "media", exact: true }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `library fits at ${width}`);
  }
  assert.equal(writes.filter((entry) => entry.path === "/api/media").length, 3);
  assert.deepEqual(unexpected, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log("Admin fixture browser PASS: movie/anime/series wizard, validation/back navigation, partial-save retry, editing, inline season creation, 1–24 range/duplicate protection, quality saves/failure/retry/non-overwrite, responsive 320–1280px. No live DB/R2 evidence; real R2 remains covered by disposable CI mocks.");
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
