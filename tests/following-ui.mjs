// Database-free browser check: serve built static HTML/assets and in-memory API
// fixtures only. Never import the application server, pg, or a migration runner.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

const statuses = ["plan_to_watch", "watching", "continue", "on_hold", "watched"];
let following = statuses.map((watchStatus, i) => ({ id: i + 1, title: `Fixture anime ${i + 1}`, slug: `fixture-${i + 1}`, type: "anime", posterUrl: null, hasNew: i === 0, watchStatus }));
const notification = { id: 1, mediaId: 1, title: "Fixture anime 1", episodeNumber: 2, episodeTitle: "New episode", seasonNumber: 1, url: "/anime/fixture-1#episode-2", readAt: null, createdAt: "2026-11-05T00:00:00.000Z" };
const writes = [], unexpected = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (data) => { res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "private, no-store"); res.end(JSON.stringify(data)); };
  try {
    if (url.pathname === "/api/updates") return json({ following, notifications: [notification], unread: notification.readAt ? 0 : 1, hasMore: false });
    if (url.pathname === "/api/site-settings") return json({ wallpaperUrl: null });
    if (url.pathname === "/api/media") return json({ media: [], total: 0 });
    if (url.pathname === "/api/follows") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); writes.push({ method: req.method, ...body });
      if (req.method === "PATCH") following = following.map((item) => item.id === body.mediaId ? { ...item, watchStatus: body.watchStatus } : item);
      if (req.method === "DELETE") following = following.filter((item) => item.id !== body.mediaId);
      return json({ following: req.method !== "DELETE", followerCount: following.length });
    }
    if (url.pathname === "/api/notifications") {
      if (req.method === "PATCH") notification.readAt = new Date().toISOString();
      return json({ notifications: [notification], hasMore: false });
    }
    if (url.pathname.startsWith("/api/")) { unexpected.push(url.pathname); res.statusCode = 404; return json({ error: "No fixture" }); }
    let file;
    if (["/", "/following", "/notifications"].includes(url.pathname)) file = `.next/server/app/${url.pathname === "/notifications" ? "notifications" : "following"}.html`;
    else if (url.pathname.startsWith("/_next/static/")) file = `.next/static/${url.pathname.slice("/_next/static/".length)}`;
    else if (["/sw.js", "/manifest.webmanifest", "/offline.html"].includes(url.pathname) || url.pathname.startsWith("/icons/")) file = `public${url.pathname}`;
    else { res.statusCode = 404; return res.end("No fixture page"); }
    const absolute = path.resolve(file);
    assert.ok(absolute.startsWith(`${process.cwd()}/.next/`) || absolute.startsWith(`${process.cwd()}/public/`));
    const extensions = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png" };
    res.setHeader("Content-Type", extensions[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(absolute));
  } catch { res.statusCode = 500; res.end("Fixture server error"); }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br")); setupLambdaEnvironment("/tmp/al2023/lib");
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const errors = [], external = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.permissionRequests = 0;
    if (window.Notification) Object.defineProperty(Notification, "requestPermission", { value: async () => { window.permissionRequests++; return "denied"; } });
  });
  await page.goto(`${base}/following`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "All (5)", exact: true }).waitFor();
  assert.equal(await page.locator("article").count(), 5);
  const labels = ["Plan to Watch", "Watching", "Continue", "On-Hold", "Watched"];
  for (const label of labels) {
    await page.getByRole("button", { name: `${label} (1)`, exact: true }).click();
    assert.equal(await page.locator("article").count(), 1);
  }
  await page.getByRole("button", { name: "All (5)", exact: true }).click();
  const first = page.locator("article").filter({ hasText: "Fixture anime 1" });
  await first.getByLabel("Watch status", { exact: true }).selectOption("watching");
  await page.getByRole("button", { name: "Watching (2)", exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("article").filter({ hasText: "Fixture anime 1" }).getByLabel("Watch status", { exact: true }).inputValue(), "watching");
  await page.getByRole("button", { name: "Plan to Watch (0)", exact: true }).click();
  await page.getByText("No titles with this status yet.").waitFor();
  await page.getByRole("button", { name: "All (5)", exact: true }).click();
  await page.locator("article").filter({ hasText: "Fixture anime 1" }).getByRole("button", { name: "Unfollow", exact: true }).click();
  await page.getByRole("button", { name: "All (4)", exact: true }).waitFor();
  assert.equal(following.length, 4);
  await page.getByLabel("Notifications, 1 unread", { exact: true }).click();
  await page.getByRole("button", { name: "Mark all read", exact: true }).click();
  await page.getByLabel("Notifications", { exact: true }).waitFor();
  assert.ok(notification.readAt);
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/following", "/notifications"]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflow at ${width}`);
    }
  }
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  assert.deepEqual(writes.map((write) => write.method), ["PATCH", "DELETE"]);
  assert.deepEqual(unexpected, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  // Real service-worker lifecycle/static caching/offline, on fixture pages only.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifest = await (await context.request.get(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) assert.equal((await context.request.get(`${base}${icon.src}`)).status(), 200);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async (name) => (await (await caches.open(name)).keys()).map((req) => new URL(req.url).pathname)))).flat();
  });
  assert.ok(cached.includes("/offline.html"));
  assert.ok(cached.some((key) => key.startsWith("/_next/static/")));
  assert.ok(cached.every((key) => !key.startsWith("/api/") && !key.startsWith("/admin")));
  await context.setOffline(true);
  await page.goto(`${base}/following`, { waitUntil: "domcontentloaded" });
  assert.match(await page.locator("body").innerText(), /offline/i);
  console.log("Database-free browser PASS: five filters, saved status/reload, empty filter, unfollow, bell mark-read, no permission/external calls, no overflow at 360/390/768/1280px; real SW activation/static caching, manifest/icons and offline fallback on fixture pages. Live API/database integration is NOT tested.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
