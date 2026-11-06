// Real built Admin UI + in-memory API fixtures. No database or provider access.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

let nextId = 1, failLink = false;
let failRestoreId = null, failBinRead = false;
let binItems = [
  { kind: "media", id: 100, mediaId: 100, title: "Deleted movie", mediaTitle: "Deleted movie", type: "movie" },
  { kind: "media", id: 500, mediaId: 500, title: "Deleted anime", mediaTitle: "Deleted anime", type: "anime" },
  { kind: "media", id: 400, mediaId: 400, title: "Blocked series", mediaTitle: "Blocked series", type: "series" },
  { kind: "season", id: 301, mediaId: 300, seasonId: 301, seasonNumber: 1, title: "Another Anime · Season 1", mediaTitle: "Another Anime", type: "anime" },
  ...Array.from({ length: 110 }, (_, i) => ({ kind: "episode", id: 21001 + i, mediaId: 200, mediaTitle: "Attack on Titan", seasonId: 201, seasonNumber: 1, episodeNumber: i + 1, title: `Attack on Titan · Season 1 · Episode ${i + 1}`, type: "anime" })),
  ...Array.from({ length: 6 }, (_, i) => ({ kind: "episode", id: 22001 + i, mediaId: 200, mediaTitle: "Attack on Titan", seasonId: 202, seasonNumber: 2, episodeNumber: i + 1, title: `Attack on Titan · Season 2 · Episode ${i + 1}`, type: "anime" })),
  ...Array.from({ length: 4 }, (_, i) => ({ kind: "episode", id: 23001 + i, mediaId: 300, mediaTitle: "Another Anime", seasonId: 301, seasonNumber: 1, episodeNumber: i + 1, title: `Another Anime · Season 1 · Episode ${i + 1}`, type: "anime", parentDeleted: true })),
  ...Array.from({ length: 3 }, (_, i) => ({ kind: "episode", id: 24001 + i, mediaId: 400, mediaTitle: "Blocked series", seasonId: 401, seasonNumber: 1, episodeNumber: i + 1, title: `Blocked series · Season 1 · Episode ${i + 1}`, type: "series", parentDeleted: true })),
].map((item) => ({ ...item, deletedAt: "2026-11-07T00:00:00Z" }));
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
    if (url.pathname === "/api/contact/requests") return json([]);
    if (url.pathname === "/api/admin/comments") return json(url.searchParams.get("view") === "all" ? { comments: [] } : []);
    if (url.pathname === "/api/updates") return json({ following: [], notifications: [], unread: 0 });
    if (url.pathname === "/api/admin/recycle-bin") {
      if (req.method === "GET") {
        if (failBinRead) { failBinRead = false; return json({ error: "Fixture bin read failed" }, 503); }
        const offset = Number(url.searchParams.get("offset") || 0);
        return json({ ready: true, items: binItems.slice(offset, offset + 100), total: binItems.length });
      }
      if (body.action === "empty") { if (body.confirmation !== "EMPTY RECYCLE BIN") return json({ error: "Confirmation required" }, 400); binItems = []; return json({ success: true }); }
      const item = binItems.find((entry) => entry.kind === body.kind && entry.id === body.id);
      if (!item) return json({ error: "Not found" }, 404);
      if (body.action === "restore") {
        if (item.parentDeleted) return json({ error: "Restore the parent title/season first. Nothing was changed." }, 409);
        if (item.id === failRestoreId) { failRestoreId = null; return json({ error: "Fixture interrupted restoration" }, 503); }
        if (item.kind === "media") binItems.filter((entry) => entry.mediaId === item.id).forEach((entry) => { entry.parentDeleted = false; });
        if (item.kind === "season") binItems.filter((entry) => entry.seasonId === item.id).forEach((entry) => { entry.parentDeleted = false; });
      } else if (body.action !== "purge" || body.confirmation !== `DELETE PERMANENTLY ${item.kind}:${item.id}`) return json({ error: "Confirmation required" }, 400);
      binItems = binItems.filter((entry) => entry !== item); return json({ success: true });
    }
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
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message)); const automaticDialog = (dialog) => dialog.accept(); page.on("dialog", automaticDialog);
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  const assertFits = async (screen) => {
    for (const width of [320, 360, 390, 768, 1280]) {
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
    await assertFits("details and poster");
    assert.equal(await page.getByLabel("Poster URL", { exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), title);
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
    await page.getByText("Individual editing & files", { exact: true }).click();
    await page.getByTestId("individual-episode-editor").getByRole("button", { name: /Season 1/ }).click();
    await page.getByText("Create a complete season", { exact: true }).waitFor();
    const individual = page.getByTestId("individual-episode-editor");
    await individual.getByLabel("Count", { exact: true }).fill("3");
    await individual.getByRole("button", { name: "Create episodes", exact: true }).click();
    await individual.getByText("Episode 1", { exact: true }).waitFor();
    assert.equal(items.at(-1).seasons[0].episodes.length, 3);
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
    const saveButton = page.getByRole("button", { name: "Save All", exact: true });
    await saveButton.scrollIntoViewIfNeeded();
    assert.equal(await saveButton.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.right - 8, box.top + box.height / 2));
    }), true, "Save All must not be covered by the public floating scroll control");
  }
  await page.getByRole("button", { name: "media", exact: true }).click();
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `library fits at ${width}`);
  }
  // Density stays scoped to Admin. Wallpaper must keep its original sizing.
  for (const name of ["categories", "requests", "Comment moderation", "File batches"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await assertFits(`${name} workspace`);
  }
  await page.getByRole("button", { name: "appearance", exact: true }).click();
  const wallpaperHeading = page.getByRole("heading", { name: "Website background wallpaper", exact: true });
  await wallpaperHeading.waitFor();
  assert.equal(await wallpaperHeading.evaluate((element) => getComputedStyle(element).fontSize), "18px", "Wallpaper retains original typography, not the Admin density overrides");
  assert.equal(await wallpaperHeading.evaluate((element) => !!element.closest('[class*="AdminCompact"]')), false, "Wallpaper has no compact-style ancestor");
  assert.equal(await page.getByRole("heading", { name: "Admin Dashboard", exact: true }).evaluate((element) => getComputedStyle(element).fontSize), "24px", "Wallpaper dashboard header keeps original size");
  // Compact bin: full metadata across >100 items; zero mounted episode rows
  // while collapsed. All mutations here hit fixture APIs, never a real DB/R2.
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click();
  const bin = page.getByRole("region", { name: "Recycle Bin", exact: true });
  await bin.getByRole("button", { name: "All 127", exact: true }).waitFor();
  assert.equal(await bin.getByTestId("bin-title-folder").count(), 3);
  assert.equal(await bin.getByTestId("bin-item-row").count(), 4, "collapsed All shows only compact non-episode rows");
  const filter = (name) => bin.getByRole("button", { name, exact: true });
  await filter("Titles 4").click(); assert.equal(await bin.getByTestId("bin-title-folder").count(), 0);
  await filter("Episodes 123").click(); assert.equal(await bin.getByTestId("bin-item-row").count(), 0);
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `collapsed bin fits ${width}`);
    assert.ok((await bin.getByTestId("bin-title-folder").first().boundingBox()).height <= 64, "compact title folder must not be a large card");
  }
  await filter("Attack on Titan 116 deleted episodes").click();
  assert.equal(await bin.getByTestId("bin-season-folder").count(), 2);
  assert.equal(await bin.getByTestId("bin-item-row").count(), 0, "title expansion alone does not mount episode rows");
  await filter("Season 2 6 deleted").click(); assert.equal(await bin.getByTestId("bin-item-row").count(), 6);
  await filter("Season 2 6 deleted").click(); assert.equal(await bin.getByTestId("bin-item-row").count(), 0);
  await filter("Season 2 6 deleted").click();
  await bin.getByRole("button", { name: "Restore Attack on Titan · Season 2 · Episode 1", exact: true }).click();
  await filter("Season 2 5 deleted").waitFor();
  failRestoreId = 22004;
  await bin.getByRole("button", { name: "Restore all deleted episodes in Attack on Titan, Season 2", exact: true }).click();
  await bin.getByRole("alert").filter({ hasText: "2 restored; stopped safely" }).waitFor();
  await filter("Season 2 3 deleted").waitFor();
  assert.ok(binItems.some((item) => item.id === 22005), "partial failure stops before later episodes");
  await bin.getByRole("button", { name: "Restore all deleted episodes in Attack on Titan, Season 2", exact: true }).click();
  await bin.getByText("Restored 3 episodes. Other seasons and independently deleted items were not changed.", { exact: true }).waitFor();
  assert.equal(binItems.filter((item) => item.seasonId === 201).length, 110, "season restore must not touch another season");
  assert.equal(writes.filter((entry) => entry.path === "/api/admin/recycle-bin" && entry.body.id === 22002).length, 1, "retry must not repeat already-restored episodes");
  await filter("Another Anime 4 deleted episodes").click(); await filter("Season 1 4 deleted").click();
  assert.equal(await bin.getByRole("button", { name: "Restore all deleted episodes in Another Anime, Season 1", exact: true }).isDisabled(), true);
  await bin.getByRole("button", { name: "Restore Another Anime · Season 1 · Episode 1", exact: true }).click();
  await bin.getByRole("alert").filter({ hasText: "Restore the parent title/season first" }).waitFor();
  await filter("Titles 4").click();
  await bin.getByRole("button", { name: "Restore Another Anime · Season 1", exact: true }).click();
  await bin.getByRole("status").filter({ hasText: "Restored. Independently deleted children" }).waitFor();
  assert.equal(binItems.filter((item) => item.mediaId === 300).length, 4, "restoring season leaves independently deleted episodes in bin");
  await filter("Episodes 117").click();
  await bin.getByRole("button", { name: "Restore all deleted episodes in Another Anime, Season 1", exact: true }).click();
  await bin.getByText("Restored 4 episodes. Other seasons and independently deleted items were not changed.", { exact: true }).waitFor();
  await filter("Titles 3").click(); await bin.getByRole("button", { name: "Restore Blocked series", exact: true }).click();
  await filter("Titles 2").waitFor();
  assert.equal(binItems.filter((item) => item.mediaId === 400).length, 3, "parent title restore preserves independent child trash");
  await filter("Episodes 113").click();
  await filter("Blocked series 3 deleted episodes").click(); await filter("Season 1 3 deleted").click();
  assert.equal(await bin.getByRole("button", { name: "Restore all deleted episodes in Blocked series, Season 1", exact: true }).isDisabled(), false);
  await filter("Attack on Titan 110 deleted episodes").click(); // collapse existing title
  await filter("Attack on Titan 110 deleted episodes").click();
  await filter("Season 1 110 deleted").click();
  page.off("dialog", automaticDialog); let promptReply;
  page.on("dialog", (dialog) => dialog.type() === "prompt" ? promptReply === undefined ? dialog.dismiss() : dialog.accept(promptReply) : dialog.accept());
  const deleteEpisode = bin.getByRole("button", { name: "Permanently delete Attack on Titan · Season 1 · Episode 1", exact: true });
  let mutationCount = writes.length;
  await deleteEpisode.click(); assert.equal(writes.length, mutationCount, "cancelled purge never sends mutation");
  promptReply = "wrong"; await deleteEpisode.click(); assert.equal(writes.length, mutationCount, "wrong purge confirmation never sends mutation");
  promptReply = "DELETE PERMANENTLY episode:21001"; await deleteEpisode.click();
  await filter("Attack on Titan 109 deleted episodes").waitFor(); assert.ok(!binItems.some((item) => item.id === 21001));
  for (const width of [320, 360, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `expanded bin fits ${width}`); }
  failBinRead = true; await filter("Refresh bin").click(); await bin.getByRole("alert").filter({ hasText: "Fixture bin read failed" }).waitFor();
  assert.equal(await filter("Empty Recycle Bin").isDisabled(), true, "stale metadata cannot drive mutations");
  await filter("Refresh bin").click(); await page.waitForFunction(() => !document.querySelector('section[aria-label="Recycle Bin"]').getAttribute("aria-busy")?.includes("true"));
  mutationCount = writes.length; promptReply = "wrong"; await filter("Empty Recycle Bin").click(); assert.equal(writes.length, mutationCount);
  promptReply = undefined; await filter("Empty Recycle Bin").click(); assert.equal(writes.length, mutationCount);
  promptReply = "EMPTY RECYCLE BIN"; await filter("Empty Recycle Bin").click();
  await bin.getByText("Recycle Bin is empty.", { exact: true }).waitFor(); assert.equal(binItems.length, 0);
  assert.equal(await bin.getByTestId("bin-title-folder").count(), 0);
  assert.equal(writes.filter((entry) => entry.path === "/api/media").length, 3);
  assert.deepEqual(unexpected, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log("Admin fixture browser PASS: All/Titles/Episodes bin filters, 127-item paged grouping, unmounted collapsed rows, parent-aware/partial-failure season restore, individual restore/purge, typed empty confirmation, Wallpaper density isolation, compact category/request/moderation/file-batch layouts; movie/anime/series wizard, validation/back navigation, partial-save retry, editing, inline season creation, 1–24 range/duplicate protection, quality saves/failure/retry/non-overwrite, responsive 320–1280px. No live DB/R2 evidence; real R2 remains covered by disposable CI mocks.");
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
