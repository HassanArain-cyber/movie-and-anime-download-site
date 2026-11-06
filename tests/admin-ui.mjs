// Real built Admin UI + in-memory API fixtures. No database or provider access.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

let nextId = 1, failLink = false;
let moderationItems = [], requestItems = [], deleteAllError = false, deleteAllRefreshError = false, deleteAllDelay = false;
let failNextCollectionRead = false;

let failRestoreId = null, failPurgeId = null, failBinRead = false;
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
    if (["POST", "PATCH", "DELETE"].includes(req.method)) { let raw = ""; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; writes.push({ path: url.pathname, body }); }
    if (url.pathname === "/api/site-settings") return json({ wallpaperUrl: null, wallpaperOverlay: 65, wallpaperBlur: 0 });
    if (url.pathname === "/api/auth/session") return json({ authed: true });
    if (url.pathname === "/api/categories") return json([{ id: 1, name: "Action", slug: "action" }]);
    if (url.pathname === "/api/storage/status") return json({ configured: false, missing: ["test R2 configuration"], maxVideoBytes: 100000, maxImageBytes: 100000, partSizeBytes: 5242880, privateDownloads: true });
    if (["/api/contact/requests", "/api/admin/comments"].includes(url.pathname)) {
      const comments = url.pathname === "/api/admin/comments";
      if (req.method === "DELETE") {
        if (deleteAllDelay) await new Promise((resolve) => setTimeout(resolve, 500));
        if (deleteAllError) { deleteAllError = false; return json({ error: "Fixture Delete All API error" }, 503); }
        if (body.confirm !== true) return json({ error: "Confirmation required" }, 400);
        const deleted = comments ? moderationItems.length : requestItems.length;
        if (comments) moderationItems = []; else requestItems = [];
        if (deleteAllRefreshError) { failNextCollectionRead = true; deleteAllRefreshError = false; }
        return json({ success: true, deleted });
      }
      if (failNextCollectionRead) { failNextCollectionRead = false; return json({ error: "Fixture refresh error" }, 503); }
      // Comments expose at most 200 items; unreported comments may be invisible
      // in the default report queue. DELETE still removes every fixture record.
      return json(comments ? url.searchParams.get("view") === "all" ? { comments: moderationItems.slice(0, 200) } : [] : requestItems.slice(0, 200));
    }
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
      if (body.action === "purge" && item.id === failPurgeId) { failPurgeId = null; return json({ error: "Fixture purge failed" }, 503); }
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
  // Search starts as an icon, and opening it must immediately focus the input.
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.getByRole("searchbox", { name: "Filter media by title or type" }).count(), 0);
    const toggle = page.getByRole("button", { name: "Search media", exact: true });
    if (width === 390) { await toggle.focus(); await page.keyboard.press("Enter"); } else await toggle.click();
    const search = page.getByRole("searchbox", { name: "Filter media by title or type" });
    assert.equal(await search.evaluate((element) => element === document.activeElement), true, "one action opens AND focuses search");
    await page.keyboard.type("Wizard movie");
    assert.equal(await page.getByRole("row").count(), 2, "title filtering still works without a second click");
    await search.press("Escape");
    assert.equal(await search.count(), 0); assert.equal(await toggle.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.getByRole("row").count(), 4, "closing clears filter and restores library");
    await toggle.click(); await page.keyboard.type("anime");
    assert.equal(await page.getByRole("row").count(), 2, "type filtering is preserved");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `open search fits ${width}`);
    await page.getByRole("button", { name: "Close media search", exact: true }).click();
    assert.equal(await search.count(), 0); assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  }
  // Verify actual opening/reverse transitions, not just a CSS class name.
  // Focus is sampled BEFORE awaiting animations; motion must never gate typing.
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const motion = await page.evaluate(async () => {
        const shell = document.querySelector('[data-testid="media-search-shell"]');
        const toggle = shell.querySelector('button[aria-label="Search media"]');
        const input = shell.querySelector("input");
        const field = document.getElementById("admin-media-search");
        const add = [...document.querySelectorAll("button")].find((element) => element.textContent === "+ Add media");
        const measure = () => ({ addX: add.getBoundingClientRect().x, addY: add.getBoundingClientRect().y, tableY: document.querySelector("table").getBoundingClientRect().y, width: shell.getBoundingClientRect().width });
        const finish = async () => { await Promise.all(shell.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))); };
        await finish(); const before = measure();
        toggle.click(); await new Promise(requestAnimationFrame);
        const focusDuringOpen = document.activeElement === input;
        const openingProperties = shell.getAnimations().map((animation) => animation.transitionProperty);
        const duration = getComputedStyle(shell).transitionDuration;
        await finish(); const opened = measure(); const opacity = getComputedStyle(field).opacity;
        toggle.click(); await new Promise(requestAnimationFrame);
        const closedInertImmediately = field.inert && field.getAttribute("aria-hidden") === "true";
        const closingProperties = shell.getAnimations().map((animation) => animation.transitionProperty);
        await finish(); const closed = measure();
        for (let attempt = 0; attempt < 3; attempt++) { toggle.click(); await new Promise(requestAnimationFrame); toggle.click(); await new Promise(requestAnimationFrame); }
        await finish();
        return { before, opened, closed, duration, opacity, focusDuringOpen, openingProperties, closingProperties, closedInertImmediately, inputStillMounted: input.isConnected, focusReturned: document.activeElement === toggle };
      });
      assert.equal(motion.focusDuringOpen, true, "input focuses in opening commit, before the transition finishes");
      assert.ok(motion.opened.width > motion.before.width, `search expands at ${width}`);
      assert.ok(Math.abs(motion.closed.width - motion.before.width) < 1, "closing reverses to the icon width");
      assert.equal(motion.opacity, "1"); assert.equal(motion.closedInertImmediately, true);
      assert.equal(motion.inputStillMounted, true, "do not unmount before a closing transition can run");
      assert.equal(motion.focusReturned, true);
      for (const coordinate of ["addX", "addY", "tableY"]) { assert.ok(Math.abs(motion.before[coordinate] - motion.opened[coordinate]) < 1, `no layout jump: ${coordinate}`); assert.ok(Math.abs(motion.before[coordinate] - motion.closed[coordinate]) < 1); }
      if (reducedMotion === "reduce") { assert.equal(motion.duration, "0s"); assert.equal(motion.openingProperties.length, 0); assert.equal(motion.closingProperties.length, 0); }
      else { assert.ok(motion.openingProperties.includes("width"), "real width transition on open"); assert.ok(motion.closingProperties.includes("width"), "real width transition on close"); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `animated search fits ${width}`);
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Rapid reversal must keep focus and input value usable, without delayed timers.
  const searchToggle = page.getByRole("button", { name: "Search media", exact: true });
  await searchToggle.click(); await page.keyboard.press("Escape"); await searchToggle.click();
  await page.keyboard.type("Wizard movie"); assert.equal(await page.getByRole("row").count(), 2);
  await page.keyboard.press("Escape"); assert.equal(await page.getByRole("row").count(), 4);
  // The real shared public header: purple/blue/red rim, immediate focus,
  // finite expand/reverse transitions, clean text and a static reduced-motion rim.
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const publicMotion = await page.evaluate(async () => {
        const shell = document.querySelector('[data-testid="public-search-shell"]');
        const toggle = shell.querySelector('button[aria-label="Open anime search"]');
        const input = shell.querySelector("input"), field = document.getElementById("public-search-field");
        const finish = async () => Promise.all(shell.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
        const measure = () => ({ width: shell.getBoundingClientRect().width, headerHeight: document.querySelector("header").getBoundingClientRect().height, mainY: document.querySelector("main").getBoundingClientRect().y });
        const before = measure(); toggle.click(); await new Promise(requestAnimationFrame);
        const focusBeforeFinish = document.activeElement === input, properties = shell.getAnimations().map((animation) => animation.transitionProperty);
        await finish(); const open = measure();
        const rim = getComputedStyle(shell, "::before");
        const firstTransform = rim.transform;
        if (!matchMedia("(prefers-reduced-motion: reduce)").matches) await new Promise((resolve) => setTimeout(resolve, 90));
        const rotated = firstTransform !== getComputedStyle(shell, "::before").transform;
        const ring = { rotated, gradient: rim.backgroundImage, playState: rim.animationPlayState, name: rim.animationName, opacity: rim.opacity, glow: getComputedStyle(shell).boxShadow };
        toggle.click(); await new Promise(requestAnimationFrame);
        const reverse = shell.getAnimations().map((animation) => animation.transitionProperty);
        const inactive = field.inert && field.getAttribute("aria-hidden") === "true";
        await finish(); const closed = measure();
        for (let attempt = 0; attempt < 3; attempt++) { toggle.click(); await new Promise(requestAnimationFrame); toggle.click(); await new Promise(requestAnimationFrame); }
        await finish();
        return { before, open, closed, focusBeforeFinish, properties, reverse, ring, inactive, focusReturned: document.activeElement === toggle, closedRing: getComputedStyle(shell, "::before").opacity };
      });
      assert.equal(publicMotion.focusBeforeFinish, true, "public search focuses BEFORE expansion finishes");
      assert.ok(publicMotion.open.width > publicMotion.before.width); assert.ok(Math.abs(publicMotion.closed.width - publicMotion.before.width) < 1);
      assert.equal(publicMotion.inactive, true); assert.equal(publicMotion.focusReturned, true);
      assert.equal(publicMotion.ring.opacity, "1"); assert.equal(publicMotion.closedRing, "0");
      for (const color of ["rgb(168, 85, 247)", "rgb(59, 130, 246)", "rgb(239, 68, 68)"]) assert.ok(publicMotion.ring.gradient.includes(color), `rim contains ${color}`);
      assert.notEqual(publicMotion.ring.glow, "none");
      for (const coordinate of ["headerHeight", "mainY"]) assert.ok(Math.abs(publicMotion.before[coordinate] - publicMotion.open[coordinate]) < 1, "activation must not shift the public header/content");
      if (reducedMotion === "reduce") { assert.equal(publicMotion.ring.name, "none"); assert.equal(publicMotion.properties.length, 0); assert.equal(publicMotion.reverse.length, 0); }
      else { assert.equal(publicMotion.ring.rotated, true, "the gradient actually rotates, not just an animation declaration"); assert.equal(publicMotion.ring.playState, "running"); assert.ok(publicMotion.properties.includes("width")); assert.ok(publicMotion.reverse.includes("width")); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `public animated search fits ${width}`);
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Open anime search", exact: true }).click();
  const publicInput = page.getByRole("combobox", { name: "Search movies, anime, and series", exact: true });
  assert.equal(await publicInput.evaluate((element) => document.activeElement === element), true);
  await page.keyboard.type("Wizard");
  await page.locator("#search-suggestions").getByRole("link").first().waitFor();
  await publicInput.press("Escape"); assert.equal(await publicInput.count(), 0);
  await page.getByRole("button", { name: "Open anime search", exact: true }).click();
  assert.equal(await publicInput.inputValue(), "Wizard", "closing the public animation preserves the existing query");
  await publicInput.fill(""); await page.getByRole("button", { name: "Close anime search", exact: true }).click();
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
  page.off("dialog", automaticDialog); let acceptConfirmation = false;
  const confirmations = [];
  page.on("dialog", (dialog) => { confirmations.push({ type: dialog.type(), message: dialog.message() }); return acceptConfirmation ? dialog.accept() : dialog.dismiss(); });
  const deleteEpisode = bin.getByRole("button", { name: "Permanently delete Attack on Titan · Season 1 · Episode 1", exact: true });
  let mutationCount = writes.length;
  await deleteEpisode.click(); assert.equal(writes.length, mutationCount, "Cancel purge never sends mutation");
  assert.deepEqual(confirmations.at(-1), { type: "confirm", message: "Are you sure you want to permanently delete this episode? This action cannot be undone." });
  acceptConfirmation = true; failPurgeId = 21001;
  await deleteEpisode.click(); await bin.getByRole("alert").filter({ hasText: "Fixture purge failed" }).waitFor();
  assert.ok(binItems.some((item) => item.id === 21001), "failed permanent deletion retains the row and exposes API error");
  await deleteEpisode.click();
  await filter("Attack on Titan 109 deleted episodes").waitFor(); assert.ok(!binItems.some((item) => item.id === 21001));
  // Scroll a long section, switch directly from sticky tabs, then return.
  const adminNav = page.getByRole("navigation", { name: "Admin sections", exact: true });
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const titleFolder = filter("Attack on Titan 109 deleted episodes");
    if (await titleFolder.getAttribute("aria-expanded") === "false") await titleFolder.click();
    const seasonFolder = filter("Season 1 109 deleted");
    if (await seasonFolder.getAttribute("aria-expanded") === "false") await seasonFolder.click();
    await page.evaluate(async () => { window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: "instant" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.ok(await page.evaluate(() => scrollY) > 200, "test must actually scroll a long Admin section");
    const navBox = await adminNav.boundingBox(), headerBox = await page.locator("header").boundingBox();
    assert.ok(Math.abs(navBox.y - (headerBox.y + headerBox.height)) <= 2, `sticky Admin tabs clear the public header at ${width}`);
    assert.ok(navBox.y + navBox.height < 900, "Admin tabs stay visible");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `expanded bin fits ${width}`);
    await adminNav.getByRole("button", { name: "requests", exact: true }).click();
    const requestsHeading = page.getByRole("heading", { name: "Submitted requests", exact: true });
    await requestsHeading.waitFor();
    assert.equal(await adminNav.getByRole("button", { name: "requests", exact: true }).getAttribute("aria-current"), "page");
    const headingBox = await requestsHeading.boundingBox(), switchedNav = await adminNav.boundingBox();
    assert.ok(headingBox.y >= switchedNav.y + switchedNav.height - 1, "new section starts below sticky navigation, not behind it");
    await adminNav.getByRole("button", { name: "Recycle Bin", exact: true }).click();
    await filter("Attack on Titan 109 deleted episodes").waitFor();
  }
  // The same concise dialog covers seasons and titles; payloads stay unchanged.
  binItems.push({ kind: "season", id: 302, mediaId: 300, mediaTitle: "Another Anime", seasonId: 302, seasonNumber: 2, type: "anime", title: "Another Anime · Season 2", deletedAt: "2026-11-07T00:00:00Z" });
  await filter("Refresh bin").click(); await filter("Titles 3").click();
  const deleteSeason = bin.getByRole("button", { name: "Permanently delete Another Anime · Season 2", exact: true });
  acceptConfirmation = false; mutationCount = writes.length; await deleteSeason.click(); assert.equal(writes.length, mutationCount);
  assert.deepEqual(confirmations.at(-1), { type: "confirm", message: "Are you sure you want to permanently delete this season? This action cannot be undone." });
  acceptConfirmation = true; await deleteSeason.click(); await filter("Titles 2").waitFor();
  assert.equal(writes.at(-1).body.confirmation, "DELETE PERMANENTLY season:302");
  const deleteTitle = bin.getByRole("button", { name: "Permanently delete Deleted movie", exact: true });
  acceptConfirmation = false; mutationCount = writes.length; await deleteTitle.click(); assert.equal(writes.length, mutationCount);
  assert.deepEqual(confirmations.at(-1), { type: "confirm", message: "Are you sure you want to permanently delete this title? This action cannot be undone." });
  acceptConfirmation = true; await deleteTitle.click(); await filter("Titles 1").waitFor();
  assert.equal(writes.at(-1).body.confirmation, "DELETE PERMANENTLY media:100");
  failBinRead = true; await filter("Refresh bin").click(); await bin.getByRole("alert").filter({ hasText: "Fixture bin read failed" }).waitFor();
  assert.equal(await filter("Empty Recycle Bin").isDisabled(), true, "stale metadata cannot drive mutations");
  await filter("Refresh bin").click(); await page.waitForFunction(() => !document.querySelector('section[aria-label="Recycle Bin"]').getAttribute("aria-busy")?.includes("true"));
  mutationCount = writes.length; acceptConfirmation = false;
  await filter("Empty Recycle Bin").click(); assert.equal(writes.length, mutationCount, "Cancel empty bin never sends mutation");
  assert.deepEqual(confirmations.at(-1), { type: "confirm", message: "Are you sure you want to permanently empty the Recycle Bin? This action cannot be undone." });
  acceptConfirmation = true; await filter("Empty Recycle Bin").click();
  await bin.getByText("Recycle Bin is empty.", { exact: true }).waitFor(); assert.equal(binItems.length, 0);
  assert.equal(await bin.getByTestId("bin-title-folder").count(), 0);
  // Global Delete All is intentionally not scoped to the visible filter/page.
  for (const kind of ["comments", "requests"]) {
    const records = Array.from({ length: 511 }, (_, index) => kind === "comments" ? { id: index + 1, parentId: null, body: `Comment ${index}`, isHidden: index % 2 === 0, isSpoiler: false, reportCount: 0, mediaId: 1, mediaTitle: "Fixture", mediaType: "anime", episodeId: null, createdAt: "2026-11-07T00:00:00Z" } : { id: index + 1, name: `Request ${index}`, requestType: "Anime", message: "Fixture request", createdAt: "2026-11-07T00:00:00Z" });
    if (kind === "comments") moderationItems = records; else requestItems = records;
    await adminNav.getByRole("button", { name: kind === "comments" ? "Comment moderation" : "requests", exact: true }).click();
    const section = page.getByRole("region", { name: kind === "comments" ? "Comment moderation" : "Submitted requests", exact: true });
    const deleteAll = section.getByRole("button", { name: "Delete All", exact: true });
    await page.waitForFunction((label) => { const section = document.querySelector(`[aria-labelledby="${label}"]`); const button = [...section.querySelectorAll("button")].find((entry) => entry.textContent === "Delete All"); return button && !button.disabled; }, kind === "comments" ? "comment-moderation-heading" : "requests-heading");
    for (const width of [320, 360, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${kind} Delete All fits ${width}`); }
    acceptConfirmation = false; mutationCount = writes.length; await deleteAll.click(); assert.equal(writes.length, mutationCount, "Cancel never sends collection DELETE");
    assert.deepEqual(confirmations.at(-1), { type: "confirm", message: `Are you sure you want to permanently delete all ${kind}?` });
    assert.equal((kind === "comments" ? moderationItems : requestItems).length, 511);
    acceptConfirmation = true; deleteAllError = true;
    await deleteAll.click(); await section.getByRole("alert").filter({ hasText: "Fixture Delete All API error" }).waitFor();
    assert.equal((kind === "comments" ? moderationItems : requestItems).length, 511, "API failure retains records");
    deleteAllDelay = true; deleteAllRefreshError = true;
    await deleteAll.click();
    await section.getByRole("status").filter({ hasText: `Deleting all ${kind}…` }).waitFor();
    assert.equal(await adminNav.getByRole("button", { name: "media", exact: true }).isDisabled(), true, "navigation locks while deleting");
    assert.equal(await section.getByRole("button", { name: "Deleting…", exact: true }).isDisabled(), true);
    await section.getByRole("status").filter({ hasText: `Deleted 511 ${kind}.` }).waitFor();
    await section.getByRole("alert").filter({ hasText: "Deletion completed, but the list could not be refreshed" }).waitFor();
    assert.equal((kind === "comments" ? moderationItems : requestItems).length, 0, "all pages cleared, not only 200 visible records");
    deleteAllDelay = false;
    await section.getByRole("button", { name: "Refresh", exact: true }).click();
    await section.getByText(kind === "comments" ? "No reports in this queue." : "No requests have been submitted yet.", { exact: true }).waitFor();
    // A second, empty operation is safe and still refreshes successfully.
    await deleteAll.click(); await section.getByRole("status").filter({ hasText: `Deleted 0 ${kind}.` }).waitFor();
    if (kind === "comments") { await section.getByLabel("Moderation view").selectOption("comments"); await section.getByText("No comments to moderate.", { exact: true }).waitFor(); }
  }
  assert.equal(writes.filter((entry) => entry.path === "/api/media").length, 3);
  assert.deepEqual(unexpected, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log("Admin fixture browser PASS: public purple/blue/red rotating rim, immediate focus, stable layout, reverse fade and reduced-motion; real search expand/reverse transitions, immediate pre-animation focus, no Add Media/table layout jump, reduced-motion, rapid reversal; Comments/Requests Delete All cancellation/API error/loading/nav lock/511-row full deletion/refresh failure/empty retry; All/Titles/Episodes bin filters, 127-item paged grouping, unmounted collapsed rows, parent-aware/partial-failure season restore, individual restore/purge, Cancel/OK purge/empty confirmations with unchanged payloads and error handling, sticky section switching and one-tap focused search at 320–1280px, Wallpaper density isolation, compact category/request/moderation/file-batch layouts; movie/anime/series wizard, validation/back navigation, partial-save retry, editing, inline season creation, 1–24 range/duplicate protection, quality saves/failure/retry/non-overwrite, responsive 320–1280px. No live DB/R2 evidence; real R2 remains covered by disposable CI mocks.");
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
