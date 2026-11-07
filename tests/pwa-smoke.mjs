import assert from "node:assert/strict";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

const base = (process.env.PWA_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const baseUrl = new URL(base);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(baseUrl.hostname) && baseUrl.protocol !== "https:") {
  throw new Error("PWA smoke tests require HTTPS, except on loopback");
}

await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
setupLambdaEnvironment(path.join("/tmp", "al2023", "lib"));
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => { void caches.open("vault-static-obsolete-test"); });
  const home = await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(home?.status(), 200);
  assert.equal(await page.title(), "Gojo’s Vault — Movies, Anime & Series");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  assert.ok(manifestHref, "manifest link should be present");
  const manifestResponse = await page.request.get(new URL(manifestHref, base).toString());
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "Vault — Movies, Anime & Series");
  assert.equal(manifest.short_name, "Vault");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.theme_color, "#09090b");
  assert.equal(manifest.background_color, "#09090b");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, base).toString());
    assert.equal(response.status(), 200, `${icon.src} should be served`);
    const png = await response.body();
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${icon.src} should be a PNG`);
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.equal(png.readUInt32BE(16), width, `${icon.src} should have its declared width`);
    assert.equal(png.readUInt32BE(20), height, `${icon.src} should have its declared height`);
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const appManifest = await cdp.send("Page.getAppManifest");
  assert.ok(appManifest.url, "Chromium should parse a Web App Manifest");
  assert.deepEqual(appManifest.errors ?? [], [], "manifest should have no Chromium parsing errors");
  const installability = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors ?? [], [], "Chromium should offer installation for this secure-context PWA");

  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 }).catch(async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 });
  });
  const registrationInfo = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      scriptURL: registration.active?.scriptURL,
      state: registration.active?.state,
      updateViaCache: registration.updateViaCache,
      controlled: Boolean(navigator.serviceWorker.controller),
    };
  });
  assert.equal(new URL(registrationInfo.scope).pathname, "/");
  assert.equal(new URL(registrationInfo.scriptURL).pathname, "/sw.js");
  assert.equal(registrationInfo.state, "activated");
  assert.equal(registrationInfo.updateViaCache, "none");
  assert.equal(registrationInfo.controlled, true);
  assert.equal(await page.evaluate(() => caches.has("vault-static-obsolete-test")), false, "activation should remove stale app cache versions");

  await page.reload({ waitUntil: "networkidle" });
  const cacheAudit = await page.evaluate(async () => {
    const names = await caches.keys();
    const current = names.find((name) => name.startsWith("vault-static-"));
    const cache = current ? await caches.open(current) : null;
    const urls = cache ? (await cache.keys()).map((request) => new URL(request.url).pathname) : [];
    const apiCached = await caches.match("/api/auth/session");
    return { names, urls, apiCached: Boolean(apiCached) };
  });
  assert.ok(cacheAudit.urls.includes("/offline.html"));
  assert.ok(cacheAudit.urls.includes("/icons/icon-192.png"));
  assert.ok(cacheAudit.urls.some((url) => url.startsWith("/_next/static/")), "hashed build assets should be cached after the controlled reload");
  assert.equal(cacheAudit.apiCached, false, "auth/API responses must never enter Cache Storage");
  await page.evaluate(() => fetch("/api/auth/session", { cache: "no-store" }));
  await page.evaluate(() => fetch("/api/updates", { cache: "no-store" }));
  assert.equal(await page.evaluate(async () => Boolean(await caches.match("/api/updates"))), false, "subscriber/inbox responses must never be cached");
  assert.equal(await page.evaluate(async () => Boolean(await caches.match("/api/auth/session"))), false);

  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("body").innerText().then((text) => text.includes("Log in") || text.includes("Admin")), true, "admin route should remain available online");
  await context.setOffline(true);
  await page.goto(`${base}/anime`, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => undefined);
  assert.equal(await page.title(), "Offline — Vault", "offline navigation should show the cached offline page, not stale admin/library data");
  assert.ok((await page.locator("body").innerText()).includes("needs a connection"));
  await context.setOffline(false);

  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js") ?? false), true, "installed app should keep a refreshable worker for updates");
  await context.close();
  console.log("PWA smoke passed: manifest/installability metadata, icons, standalone launch URL, worker registration/update, static-only caching, auth/admin cache exclusion, and offline fallback.");
} finally {
  await browser.close();
}
