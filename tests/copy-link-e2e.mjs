// Disposable PostgreSQL + local mock R2 ONLY. Never target a live deployment.
// Copy Link + automatic website: the saved default, per-link overrides, every admin
// editor, and the public click flow in a mobile browser (copy first, then open).
import assert from "node:assert/strict";
import path from "node:path";
import pg from "pg";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const password = process.env.E2E_ADMIN_PASSWORD || "test-admin-password";
for (const url of [base, dbUrl, process.env.R2_ENDPOINT]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Copy Link tests refuse remote targets");
const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const run = Date.now().toString(36);

const DEFAULT_SITE = "https://downloader.example/open";
const OWN_SITE = "https://own-tool.example/start";
const NEWER_SITE = "https://newer-downloader.example/";
const SETTING = "/api/site-settings/copy-website";
const savedSite = async () => (await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'copy_link_website_url'")).rows[0]?.setting_value ?? null;

function client(ip) {
  let cookie = "";
  return async (url, { method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(`${base}${url}`, { method, headers: { "x-e2e-client-ip": ip, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { response, data };
  };
}
const admin = client("198.51.100.231"), anon = client("198.51.100.232");
const ok = (result, status = 200) => { assert.equal(result.response.status, status, `${result.response.url}: ${JSON.stringify(result.data)}`); return result.data; };
const status = async (request) => (await request).response.status;
const details = async (id) => ok(await anon(`/api/media/${id}`));
const keep = ({ id, url, linkBehavior, afterCopyUrl }) => ({ id, url, linkBehavior, afterCopyUrl });

async function uploadVideo(target) {
  const bytes = Buffer.alloc(1024, 9);
  const init = ok(await admin("/api/uploads", { method: "POST", body: { kind: "video", fileName: "copy-site.mp4", sizeBytes: bytes.length, contentType: "video/mp4", ...target } }), 201);
  for (const part of init.parts) {
    const start = (part.partNumber - 1) * init.partSizeBytes;
    const res = await fetch(part.url, { method: "PUT", body: bytes.subarray(start, Math.min(start + init.partSizeBytes, bytes.length)), headers: part.headers });
    assert.ok(res.ok, `part upload ${res.status}`);
  }
  return ok(await admin(`/api/uploads/${init.id}/complete`, { method: "POST" }));
}

let browser, phone;
try {
  // ---- The saved website is admin-only and validated; only an explicit PUT/DELETE changes it.
  assert.equal(await status(anon(SETTING)), 401);
  assert.equal(await status(anon(SETTING, { method: "PUT", body: { url: DEFAULT_SITE } })), 401);
  assert.equal(await status(anon(SETTING, { method: "DELETE" })), 401);
  ok(await admin("/api/auth/login", { method: "POST", body: { password } }));
  assert.equal(await status(admin(SETTING, { method: "PUT", body: { url: DEFAULT_SITE }, headers: { Origin: "https://evil.example" } })), 403);
  ok(await admin(SETTING, { method: "DELETE" }));
  assert.deepEqual(ok(await admin(SETTING)), { url: null });
  for (const bad of [undefined, "", "   ", "javascript:alert(1)", "ftp://downloads.example", "downloader.example", "https://user:pass@downloader.example", `https://downloader.example/${"x".repeat(2100)}`]) {
    assert.equal(await status(admin(SETTING, { method: "PUT", body: { url: bad } })), 400, `rejects ${String(bad).slice(0, 40)}`);
  }
  assert.equal(await savedSite(), null, "rejected values save nothing");

  // ---- Links accept an optional website; invalid ones are refused without creating anything.
  const movie = ok(await admin("/api/media", { method: "POST", body: { type: "movie", title: `Copy Site Movie ${run}` } }), 201);
  const addLink = (body) => admin("/api/download-links", { method: "POST", body: { mediaId: movie.id, quality: "1080p", ...body } });
  for (const bad of ["javascript:alert(1)", "downloader.example", "ftp://x.example"]) {
    assert.equal(await status(addLink({ url: "https://example.com/never-saved.mp4", linkBehavior: "copy", afterCopyUrl: bad })), 400);
  }
  assert.equal((await details(movie.id)).downloadLinks.length, 0, "an invalid website creates no link");
  const inherited = ok(await addLink({ label: "Inherits default", url: "https://www.terabox.com/s/1inherited", linkBehavior: "copy" }), 201);
  const own = ok(await addLink({ label: "Own site", url: "https://example.com/own-file.mp4", linkBehavior: "copy", afterCopyUrl: OWN_SITE }), 201);
  const telegram = ok(await addLink({ label: "Telegram copy", url: "https://t.me/example_channel/42", linkBehavior: "copy" }), 201);
  const magnet = ok(await addLink({ label: "Magnet copy", url: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567", linkBehavior: "copy" }), 201);
  ok(await addLink({ label: "Plain open", url: "https://example.com/plain-open", afterCopyUrl: "https://ignored.example/" }), 201);
  const stored = ok(await addLink({ label: "Stored copy", r2UploadId: (await uploadVideo({ mediaId: movie.id, quality: "1080p" })).id, linkBehavior: "copy", afterCopyUrl: OWN_SITE }), 201);
  assert.equal(inherited.afterCopyUrl, null, "no website means inherit the saved default");
  assert.equal(stored.storageProvider, "r2");
  assert.equal(await status(admin(`/api/download-links/${own.id}`, { method: "PATCH", body: { afterCopyUrl: "javascript:alert(1)" } })), 400);
  assert.equal((await details(movie.id)).downloadLinks.find((link) => link.id === own.id).afterCopyUrl, OWN_SITE, "a refused edit changes nothing");

  // ---- Admin browser (desktop): log in, then save the default website from the UI.
  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br")); setupLambdaEnvironment("/tmp/al2023/lib");
  const executablePath = await chromium.executablePath();
  browser = await playwright.launch({ executablePath, args: chromium.args, headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.233" } });
  const page = await adminContext.newPage(); const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const fits = async (screen) => {
    for (const width of [360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${screen} fits at ${width}px`);
    }
  };
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Admin Dashboard" }).waitFor();
  // The field is disabled while the saved website loads, so enabled means the value is final.
  const openAppearance = async () => {
    await page.getByRole("button", { name: "Appearance" }).click();
    const region = page.getByRole("region", { name: "Copy Link website", exact: true });
    await region.getByLabel("Website to Open After Copying").and(page.locator(":enabled")).waitFor();
    return region;
  };
  let settings = await openAppearance();
  const siteField = settings.getByLabel("Website to Open After Copying");
  assert.equal(await siteField.inputValue(), "", "nothing is saved until the admin saves a website");
  await fits("Copy Link website settings");
  await siteField.fill(DEFAULT_SITE);
  await settings.getByRole("button", { name: "Save website", exact: true }).click();
  await settings.getByText("Website saved. Copy Link buttons open it after copying.", { exact: true }).waitFor();
  assert.equal(await savedSite(), DEFAULT_SITE, "stored in the database");
  await page.reload({ waitUntil: "networkidle" });
  settings = await openAppearance();
  assert.equal(await siteField.inputValue(), DEFAULT_SITE, "still there after a refresh");

  // ---- Movie editor: Link Behavior + per-link website; editing and clearing it.
  await page.getByRole("button", { name: "media", exact: true }).click();
  await page.getByRole("button", { name: `Copy Site Movie ${run}`, exact: true }).click();
  const movieForm = page.getByRole("form", { name: "Download link form movie", exact: true });
  await movieForm.waitFor();
  assert.equal(await movieForm.getByLabel("Website to Open After Copying").count(), 0, "Open Link has no website field");
  await movieForm.getByLabel("Quality").selectOption("480p");
  await movieForm.getByLabel("Link Behavior").selectOption("copy");
  await movieForm.getByLabel("Website to Open After Copying").fill(OWN_SITE);
  await movieForm.getByLabel("External URL").fill("https://example.com/ui-copy.mp4");
  await fits("movie link form");
  await movieForm.getByRole("button", { name: "Add link", exact: true }).click();
  const uiRow = page.locator('[title="https://example.com/ui-copy.mp4"]').locator("xpath=..");
  await uiRow.waitFor();
  await uiRow.getByText(/copy link → own-tool\.example/i).waitFor();
  const uiLink = () => details(movie.id).then(({ downloadLinks }) => downloadLinks.find((link) => link.url === "https://example.com/ui-copy.mp4"));
  const created = await uiLink();
  assert.deepEqual([created.quality, created.linkBehavior, created.afterCopyUrl], ["480p", "copy", OWN_SITE]);
  await uiRow.getByRole("button", { name: "Edit", exact: true }).click();
  assert.equal(await movieForm.getByLabel("Website to Open After Copying").inputValue(), OWN_SITE, "editing loads the saved website");
  await movieForm.getByLabel("Website to Open After Copying").fill("");
  await movieForm.getByRole("button", { name: "Update link", exact: true }).click();
  await movieForm.getByRole("button", { name: "Add link", exact: true }).waitFor();
  assert.deepEqual(keep(await uiLink()), { ...keep(created), afterCopyUrl: null }, "blank returns the link to the saved default");
  await page.setViewportSize({ width: 1280, height: 900 });
  await movieForm.getByLabel("Link Behavior").selectOption("open");
  assert.equal(await movieForm.getByLabel("Website to Open After Copying").count(), 0);
  await movieForm.getByLabel("Link Behavior").selectOption("copy");
  await movieForm.getByLabel("Website to Open After Copying").waitFor();

  // ---- Anime: the quick episode table, season archive and episode editors all have Link Behavior.
  const anime = ok(await admin("/api/media", { method: "POST", body: { type: "anime", title: `Copy Site Anime ${run}` } }), 201);
  const season = ok(await admin("/api/seasons", { method: "POST", body: { mediaId: anime.id, seasonNumber: 1 } }), 201);
  const { episodes } = ok(await admin("/api/episodes/batch", { method: "POST", body: { seasonId: season.id, start: 1, count: 3 } }), 201);
  const existing = ok(await admin("/api/download-links", { method: "POST", body: { mediaId: anime.id, seasonId: season.id, episodeId: episodes[0].id, quality: "720p", label: "Ep1 own site", url: "https://example.com/ep1-720.mp4", linkBehavior: "copy", afterCopyUrl: OWN_SITE } }), 201);
  assert.equal(existing.afterCopyUrl, OWN_SITE);
  await page.getByRole("button", { name: "← Back to media" }).click();
  await page.getByRole("button", { name: `Copy Site Anime ${run}`, exact: true }).click();
  const quick = page.getByRole("region", { name: "Bulk episode quality links", exact: true });
  await quick.getByLabel("Link batch season").selectOption(String(season.id));
  await quick.getByLabel("Batch link quality").selectOption("720p");
  assert.equal(await quick.getByLabel("Batch link behavior").inputValue(), "open", "Open Link stays the default");
  assert.equal(await quick.getByLabel("Link for episode 1", { exact: true }).isDisabled(), true, "an existing quality is never overwritten");
  for (const number of [2, 3]) await quick.getByLabel(`Link for episode ${number}`, { exact: true }).fill(`https://example.com/ep${number}-720.mp4`);
  await quick.getByRole("button", { name: "Save All", exact: true }).click();
  await quick.getByText(/^2 saved · 0 failed/).waitFor();
  await quick.getByLabel("Batch link quality").selectOption("1080p");
  await quick.getByLabel("Batch link behavior").selectOption("copy");
  await quick.getByText(/Links saved now copy the download link, then open downloader\.example/).waitFor();
  for (const number of [1, 2, 3]) await quick.getByLabel(`Link for episode ${number}`, { exact: true }).fill(`https://example.com/ep${number}-1080.mp4`);
  await fits("quick episode links");
  await page.setViewportSize({ width: 1280, height: 900 });
  await quick.getByRole("button", { name: "Save All", exact: true }).click();
  await quick.getByText(/^3 saved · 0 failed/).waitFor();
  let animeDetails = await details(anime.id);
  const [ep1, ep2, ep3] = animeDetails.seasons[0].episodes;
  const linkOf = (episode, quality) => episode.downloadLinks.find((link) => link.quality === quality);
  assert.deepEqual(keep(linkOf(ep1, "720p")), keep(existing), "bulk saves never reset an existing link's saved settings");
  assert.equal(linkOf(ep2, "720p").linkBehavior, "open");
  assert.equal(linkOf(ep3, "720p").linkBehavior, "open");
  for (const episode of [ep1, ep2, ep3]) assert.deepEqual([linkOf(episode, "1080p").linkBehavior, linkOf(episode, "1080p").afterCopyUrl], ["copy", null], "the chosen behavior is saved with new links, inheriting the default");

  await page.getByText("Individual editing & files", { exact: true }).click();
  await page.getByTestId("individual-episode-editor").getByRole("button", { name: /Season 1/ }).click();
  const archiveForm = page.getByRole("form", { name: "Download link form complete season", exact: true });
  await archiveForm.getByText("Optional label & file size").click();
  await archiveForm.getByLabel("Label", { exact: true }).fill("Season archive");
  await archiveForm.getByLabel("Link Behavior").selectOption("copy");
  await archiveForm.getByLabel("Website to Open After Copying").fill(OWN_SITE);
  await archiveForm.getByLabel("External URL").fill("https://example.com/season-1.zip");
  await archiveForm.getByRole("button", { name: "Add link", exact: true }).click();
  await page.locator('[title="https://example.com/season-1.zip"]').waitFor();
  await page.getByTestId("individual-episode-editor").getByRole("button", { name: /Episode 2\b/ }).click();
  const episodeForm = page.getByRole("form", { name: "Download link form episode", exact: true });
  await episodeForm.getByText("Optional label & file size").click();
  await episodeForm.getByLabel("Label", { exact: true }).fill("Ep2 bonus");
  await episodeForm.getByLabel("Quality").selectOption("480p");
  await episodeForm.getByLabel("Link Behavior").selectOption("copy");
  await episodeForm.getByLabel("External URL").fill("https://example.com/ep2-480.mp4");
  await episodeForm.getByRole("button", { name: "Add link", exact: true }).click();
  await page.locator('[title="https://example.com/ep2-480.mp4"]').waitFor();
  animeDetails = await details(anime.id);
  const archive = animeDetails.seasons[0].downloadLinks.find((link) => link.url === "https://example.com/season-1.zip");
  assert.deepEqual([archive.linkBehavior, archive.afterCopyUrl, archive.episodeId], ["copy", OWN_SITE, null], "complete-season archives have Link Behavior and a website");
  const bonus = animeDetails.seasons[0].episodes[1].downloadLinks.find((link) => link.url === "https://example.com/ep2-480.mp4");
  assert.deepEqual([bonus.linkBehavior, bonus.afterCopyUrl], ["copy", null], "episode editors have Link Behavior and inherit the default");
  assert.deepEqual(keep(linkOf(animeDetails.seasons[0].episodes[0], "720p")), keep(existing), "other edits leave existing links alone");

  // ---- Bulk file batches (Bulk Add Episodes): pasted links honour the chosen behavior.
  const batch = ok(await admin("/api/media", { method: "POST", body: { type: "series", title: `Copy Site Series ${run}` } }), 201);
  const batchSeason = ok(await admin("/api/seasons", { method: "POST", body: { mediaId: batch.id, seasonNumber: 1 } }), 201);
  await page.goto(`${base}/admin`);
  await page.getByRole("button", { name: "File batches", exact: true }).click();
  await page.getByLabel("Bulk anime or series").selectOption(String(batch.id));
  await page.getByLabel("Bulk season").selectOption(String(batchSeason.id));
  assert.equal(await page.getByLabel("Bulk link behavior").inputValue(), "open", "Open Link stays the default");
  await page.getByLabel("Bulk link behavior").selectOption("copy");
  await page.getByRole("button", { name: "Add Another Episode" }).click();
  const batchRow = page.getByTestId("bulk-episode-row").first();
  await batchRow.getByLabel("Episode title", { exact: true }).fill("Batch copy one");
  await batchRow.getByLabel("Episode download link").fill("https://example.com/batch-copy-1.mp4");
  await page.getByRole("button", { name: "Save all episodes" }).click();
  await page.getByText("1 / 1 saved · 0 failed", { exact: true }).waitFor();
  assert.deepEqual((await details(batch.id)).seasons[0].episodes[0].downloadLinks.map(({ linkBehavior, afterCopyUrl }) => [linkBehavior, afterCopyUrl]), [["copy", null]]);

  // ---- Wizard: links created together with a movie follow the chosen behavior.
  await page.getByRole("button", { name: "media", exact: true }).click();
  await page.getByRole("button", { name: "+ Add media" }).click();
  await page.getByLabel("Title", { exact: true }).fill(`Copy Wizard Movie ${run}`);
  await page.getByLabel("Year", { exact: true }).fill("2026");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Link behavior", { exact: true }).selectOption("copy");
  await page.getByLabel("Download link 1", { exact: true }).fill("https://example.com/wizard-copy.mp4");
  await page.getByRole("button", { name: "Save movie", exact: true }).click();
  await page.getByRole("button", { name: "Edit details", exact: true }).waitFor();
  const wizardMovie = (await pool.query("SELECT id FROM media WHERE title = $1", [`Copy Wizard Movie ${run}`])).rows[0];
  assert.deepEqual((await details(wizardMovie.id)).downloadLinks.map((link) => [link.linkBehavior, link.afterCopyUrl]), [["copy", null]]);

  // ---- Public visitor on a phone: copy the ORIGINAL link first, then open the website.
  // This Chromium build runs single-process and crashes if a popup opens while another context is
  // alive, so the phone visitor gets a browser of its own.
  phone = await playwright.launch({ executablePath, args: chromium.args, headless: true });
  // Reused by the restart test, which must be the same profile with only its storage kept.
  const phoneOptions = {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
    permissions: ["clipboard-read", "clipboard-write"], extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.234" },
  };
  const mockSites = async (context) => {
    for (const site of [DEFAULT_SITE, OWN_SITE, NEWER_SITE]) await context.route(`${new URL(site).origin}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Mock downloader</title><p>Paste the link here</p>" }));
  };
  let visitor = await phone.newContext(phoneOptions);
  await mockSites(visitor);
  const shopper = await visitor.newPage(); const visitorErrors = []; shopper.on("pageerror", (error) => visitorErrors.push(error.message));
  const clipboard = () => shopper.evaluate(() => navigator.clipboard.readText());
  const button = (name) => shopper.getByRole("button", { name });
  // The new tab confirms the copy, then takes itself to the website. The confirmation is
  // captured in one round trip right after it appears, because the redirect follows 5s later.
  // `onOpened` runs while the new tab is counting down: the page toast only lives 5s, so it
  // must be checked inside the click flow, not after the redirect has finished.
  const tapAndExpectConfirm = async (target, site, copied, { manual = false, onOpened } = {}) => {
    const [tab] = await Promise.all([visitor.waitForEvent("page"), target.tap()]);
    if (onOpened) await onOpened(tab);
    await tab.waitForURL(/\/copy$/, { timeout: 20000 });
    const url = new URL(tab.url());
    assert.deepEqual([url.pathname, url.search, url.hash], ["/copy", "", ""], "a clean confirmation URL: no copy state in the address bar");
    // The countdown starts at 5 and each number only lives a second, so watch it first.
    await tab.getByText("Opening download website in 5 seconds…").waitFor({ timeout: 20000 });
    const probe = await tab.evaluate(() => ({
      detached: window.opener === null,
      fits: document.documentElement.scrollWidth <= innerWidth,
    }));
    assert.equal(probe.detached, true, "the confirmation tab has no handle on the download page");
    assert.equal(probe.fits, true, "the confirmation fits a phone screen");
    await tab.getByRole("button", { name: "Continue to download website" }).waitFor();
    if (manual) {
      await tab.getByRole("button", { name: "Continue to download website" }).tap();
    } else {
      const html = await tab.content(); // one snapshot, asserted offline so the 5s window cannot race us
      assert.match(html, /data-phase="ready"/);
      assert.match(html, /Link Copied Successfully!/);
      assert.match(html, /Paste the copied link on the next website to download\./);
      assert.match(html, /Continue to download website/);
      assert.ok(html.includes(`Destination: ${new URL(site).hostname}`), "the visitor sees where they are going, by host only");
      // A magnet link has no hierarchical path, so fall back to its full text as the marker.
      const parsed = /^https?:/i.test(copied) ? new URL(copied) : null;
      const needle = parsed && parsed.pathname.length > 1 ? parsed.pathname : copied;
      assert.equal(html.includes(needle), false, "the download link is never rendered on the confirmation page");
      assert.equal(html.includes(site), false, "nor is the full website address");
      // Ticking: the same line counts down on real seconds and the last one is singular.
      await tab.getByText("Opening download website in 1 second…").waitFor({ timeout: 15000 });
    }
    await tab.waitForURL(site, { timeout: 20000 });
    assert.equal(await tab.getByTestId("copy-confirmation").count(), 0, "the tab leaves the confirmation behind once the website loads");
    await tab.close(); await shopper.bringToFront();
    assert.equal(await clipboard(), copied, "the clipboard holds the download link, never the website");
  };
  // Once the two confirmations are spent, a copy goes straight to the website: no /copy tab.
  const tapAndExpectDirectOpen = async (target, site, copied) => {
    const [tab] = await Promise.all([visitor.waitForEvent("page"), target.tap()]);
    await tab.waitForURL(site, { timeout: 20000 });
    assert.equal(new URL(tab.url()).pathname, new URL(site).pathname, "the website itself opens, with no confirmation step");
    assert.equal(await tab.evaluate(() => window.opener === null), true, "the website tab has no handle on the download page");
    await tab.close(); await shopper.bringToFront();
    assert.equal(await clipboard(), copied, "the clipboard still holds the download link");
  };
  const noNewTab = async () => { await shopper.waitForTimeout(400); assert.equal(visitor.pages().length, 1, "no tab was opened"); };
  const openMoviePage = async () => { await shopper.goto(`${base}/movie/${movie.slug}`, { waitUntil: "networkidle" }); };

  await openMoviePage();
  // A brand-new browser profile: the confirmation introduction starts here.
  await shopper.evaluate(() => localStorage.clear());
  // The original page also confirms the copy, in one shared toast.
  const toast = shopper.getByTestId("copy-toast");
  const toastText = "Link copied. Continue in the new tab to download.";
  await tapAndExpectConfirm(button(/Inherits default/), DEFAULT_SITE, inherited.url, { onOpened: async () => {
    await toast.waitFor();
    assert.equal(await toast.getAttribute("data-outcome"), "opened");
    await toast.getByText(toastText).waitFor();
    assert.equal(await shopper.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the confirmation does not widen the phone layout");
    assert.deepEqual(
      [await toast.getAttribute("role"), await toast.getAttribute("aria-live"), await toast.getAttribute("aria-atomic")],
      ["status", "polite", "true"],
      "the confirmation is announced from a polite live region",
    );
  } });
  // The second and last confirmation: the manual Continue button is not decorative, it navigates.
  await tapAndExpectConfirm(button(/Own site/), OWN_SITE, own.url, { manual: true, onOpened: async () => {
    await shopper.getByTestId("copy-toast").getByText(toastText).waitFor();
    assert.equal(await shopper.getByTestId("copy-toast").count(), 1, "only one confirmation is on screen at a time");
  } });
  // Two confirmations are spent for this whole browser: every later copy opens the website directly.
  await tapAndExpectDirectOpen(button(/Telegram copy/), DEFAULT_SITE, telegram.url);
  await tapAndExpectDirectOpen(button(/Magnet copy/), DEFAULT_SITE, magnet.url);
  // Normal external pages and stored files keep navigating; websites never apply to them.
  const plain = shopper.getByRole("link", { name: /Plain open/ });
  assert.equal(await plain.getAttribute("href"), "https://example.com/plain-open");
  assert.equal(await plain.getAttribute("target"), "_blank");
  assert.equal(await button(/Plain open/).count(), 0, "Open Link has no copy button");
  const storedLink = shopper.getByRole("link", { name: /Stored copy/ });
  assert.equal(await storedLink.getAttribute("href"), `/api/download?id=${stored.id}`);
  assert.notEqual(await storedLink.getAttribute("download"), null, "stored R2 files still download directly");
  assert.equal(await button(/Stored copy/).count(), 0);
  const signed = await fetch(`${base}/api/download?id=${stored.id}`, { redirect: "manual" });
  assert.equal(signed.status, 302, "R2 downloads are still handed to a signed URL");
  assert.ok(signed.headers.get("location").startsWith(process.env.R2_ENDPOINT));

  // Popup blocker: the link is still copied and a real "Open" link takes over.
  await openMoviePage();
  await shopper.evaluate(() => { window.open = () => null; });
  await button(/Inherits default/).tap();
  await shopper.getByTestId("copy-toast").getByText(/Your browser blocked the new tab/).waitFor();
  assert.equal(await clipboard(), inherited.url);
  assert.equal(visitor.pages().length, 1, "a blocked tab shows no confirmation page");
  const manual = shopper.getByTestId("copy-toast").getByRole("link", { name: "Open downloader.example" });
  assert.deepEqual([await manual.getAttribute("href"), await manual.getAttribute("target"), await manual.getAttribute("rel")], [DEFAULT_SITE, "_blank", "noopener noreferrer"]);
  const [manualTab] = await Promise.all([visitor.waitForEvent("page"), manual.tap()]);
  await manualTab.waitForLoadState(); assert.equal(manualTab.url(), DEFAULT_SITE); await manualTab.close();
  await shopper.bringToFront();

  // Clipboard API denied: the legacy copy command still copies, then the website opens.
  await openMoviePage();
  await shopper.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")); });
  await tapAndExpectDirectOpen(button(/Inherits default/), DEFAULT_SITE, inherited.url);

  // Nothing can copy: nothing opens, and the visitor gets the original link to copy by hand.
  await openMoviePage();
  await shopper.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException("denied", "NotAllowedError")); document.execCommand = () => false; });
  await button(/Inherits default/).tap();
  await shopper.getByText(/Could not copy automatically/).waitFor();
  assert.equal(await shopper.getByTestId("copy-toast").count(), 0, "a failed copy is never confirmed as a success");
  await noNewTab();
  assert.equal(await shopper.locator("[role=status] .select-all").innerText(), inherited.url, "the manual fallback shows the download link");
  assert.equal(await shopper.getByRole("link", { name: "Open downloader.example" }).getAttribute("href"), DEFAULT_SITE);

  // A tab that never received a destination explains itself instead of redirecting anywhere.
  const orphan = await visitor.newPage();
  await orphan.goto(`${base}/copy`, { waitUntil: "domcontentloaded" });
  await orphan.getByText(/This tab could not read the download website/).waitFor();
  await orphan.waitForTimeout(2500);
  assert.ok(orphan.url().endsWith("/copy"), "nothing to open, so the tab stays on the confirmation");
  assert.equal(await orphan.getByRole("button", { name: "Continue to download website" }).count(), 0, "there is no destination to continue to");
  await orphan.close();
  await shopper.bringToFront();

  // ---- Changes happen only on explicit edits, and survive refresh, logout/login and content edits.
  const publicWebsite = async () => (await details(movie.id)).copyWebsite;
  assert.equal(await publicWebsite(), DEFAULT_SITE);
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByPlaceholder("Password").waitFor();
  assert.equal(await publicWebsite(), DEFAULT_SITE, "visitors still get the website after the admin logs out");
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  settings = await openAppearance();
  assert.equal(await siteField.inputValue(), DEFAULT_SITE, "still saved after logout and login");
  ok(await admin(`/api/media/${movie.id}`, { method: "PATCH", body: { description: "Edited description" } }));
  ok(await admin(`/api/download-links/${own.id}`, { method: "PATCH", body: { label: "Own site renamed", fileSize: "2 GB" } }));
  assert.equal(await publicWebsite(), DEFAULT_SITE, "content edits keep the saved website");
  assert.deepEqual(keep((await details(movie.id)).downloadLinks.find((link) => link.id === own.id)), keep(own), "a link edit that omits the website keeps it");
  await pool.query("UPDATE site_settings SET setting_value = $1 WHERE setting_key = 'copy_link_website_url'", [NEWER_SITE]);
  assert.equal(await publicWebsite(), NEWER_SITE, "read from the database on every request, so no restart can lose or revert it");
  await pool.query("UPDATE site_settings SET setting_value = $1 WHERE setting_key = 'copy_link_website_url'", [DEFAULT_SITE]);
  assert.equal(await status(admin(SETTING, { method: "PUT", body: { url: "   " } })), 400, "blank never deletes the saved website");
  assert.equal(await savedSite(), DEFAULT_SITE);

  // Change it from the admin UI: Copy Link buttons follow the new website immediately.
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  settings = await openAppearance();
  await siteField.fill(NEWER_SITE);
  await settings.getByRole("button", { name: "Update website", exact: true }).click();
  await settings.getByText("Saved website: https://newer-downloader.example/", { exact: true }).waitFor();
  await openMoviePage();
  await tapAndExpectDirectOpen(button(/Inherits default/), NEWER_SITE, inherited.url);
  await tapAndExpectDirectOpen(button(/Own site renamed/), OWN_SITE, own.url);

  // Anime page: season archive and episode links get the same behavior and website.
  await shopper.goto(`${base}/anime/${anime.slug}`, { waitUntil: "networkidle" });
  await tapAndExpectDirectOpen(button(/Season archive/), OWN_SITE, "https://example.com/season-1.zip");
  await shopper.locator(`#episode-${ep1.id} button[aria-expanded]`).tap();
  await tapAndExpectDirectOpen(shopper.locator(`#episode-${ep1.id}`).getByRole("button", { name: /1080p/ }), NEWER_SITE, "https://example.com/ep1-1080.mp4");
  await tapAndExpectDirectOpen(shopper.locator(`#episode-${ep1.id}`).getByRole("button", { name: /Ep1 own site/ }), OWN_SITE, "https://example.com/ep1-720.mp4");
  assert.equal(await shopper.locator(`#episode-${ep1.id}`).getByRole("link", { name: /720p/ }).count(), 0, "Open Link episodes elsewhere are unaffected");
  assert.equal(await shopper.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the phone layout does not overflow");

  // Explicit removal: Copy Link buttons go back to copy only; a link's own website still works.
  settings = await openAppearance();
  await settings.getByRole("button", { name: "Remove", exact: true }).click();
  await settings.getByText("Website removed. Copy Link buttons only copy.", { exact: true }).waitFor();
  assert.equal(await savedSite(), null);
  assert.equal(await settings.getByLabel("Website to Open After Copying").inputValue(), "");
  await openMoviePage();
  await button(/Inherits default/).tap();
  const copiedToast = shopper.getByTestId("copy-toast");
  await copiedToast.getByText("Link copied to clipboard.", { exact: true }).waitFor();
  assert.equal(await copiedToast.getAttribute("data-outcome"), "copied");
  assert.equal(await copiedToast.count(), 1, "only one confirmation is on screen");
  await noNewTab();
  assert.equal(await clipboard(), inherited.url);
  await shopper.getByRole("button", { name: "Dismiss copy confirmation" }).tap();
  assert.equal(await shopper.getByTestId("copy-toast").count(), 0, "the confirmation can be dismissed");
  await button(/Inherits default/).tap();
  await shopper.getByTestId("copy-toast").waitFor();
  await shopper.mouse.move(4, 4);
  await shopper.getByTestId("copy-toast").waitFor({ state: "detached", timeout: 15000 });
  assert.equal(await shopper.getByTestId("copy-toast").count(), 0, "the confirmation disappears on its own");
  await noNewTab();
  await tapAndExpectDirectOpen(button(/Own site renamed/), OWN_SITE, own.url);
  ok(await admin(SETTING, { method: "DELETE" }));
  assert.deepEqual(ok(await admin(SETTING)), { url: null }, "removing nothing is harmless");

  // ---- The two confirmations belong to the browser, not to a tab, a title, a reload or a session.
  const STORAGE_KEY = "vault:copy-confirmations";
  const countedIn = (target) => target.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  assert.equal(await countedIn(shopper), "2", "exactly two confirmation pages were shown in this browser");

  // 1. Another tab reads the same website-wide count.
  const otherTab = await visitor.newPage();
  await otherTab.goto(`${base}/movie/${movie.slug}`, { waitUntil: "networkidle" });
  const [fromOtherTab] = await Promise.all([visitor.waitForEvent("page"), otherTab.getByRole("button", { name: /Own site renamed/ }).tap()]);
  await fromOtherTab.waitForURL(OWN_SITE);
  assert.equal(await countedIn(otherTab), "2", "a second tab shares the count and skips the confirmation");
  await fromOtherTab.close(); await otherTab.close(); await shopper.bringToFront();

  // 2. A refresh does not reset it.
  await openMoviePage();
  await tapAndExpectDirectOpen(button(/Own site renamed/), OWN_SITE, own.url);
  assert.equal(await countedIn(shopper), "2", "reloading the page changes nothing");

  // 3. Closing and reopening the browser keeps it: localStorage is the only state.
  const savedState = await visitor.storageState();
  const savedCount = savedState.origins?.find((entry) => entry.origin === new URL(base).origin)?.localStorage?.find((item) => item.name === STORAGE_KEY)?.value;
  assert.equal(savedCount, "2", "the count lives in localStorage, so it outlives the session");
  // A real second browser, started with only the saved storage: this is the reopen case.
  const restartedBrowser = await playwright.launch({ executablePath, args: chromium.args, headless: true });
  try {
    const restarted = await restartedBrowser.newContext({ ...phoneOptions, storageState: savedState });
    await mockSites(restarted);
    const restartedPage = await restarted.newPage();
    await restartedPage.goto(`${base}/movie/${movie.slug}`, { waitUntil: "networkidle" });
    const [afterRestart] = await Promise.all([restarted.waitForEvent("page"), restartedPage.getByRole("button", { name: /Own site renamed/ }).tap()]);
    await afterRestart.waitForURL(OWN_SITE);
    assert.equal(await countedIn(restartedPage), "2", "a reopened browser still remembers both confirmations");
    await afterRestart.close(); await restarted.close();
  } finally { await restartedBrowser.close(); }

  // 4. A blocked tab never spends a confirmation: a fresh browser still gets its introduction.
  // A brand-new browser profile, where both confirmations are still available.
  const cleanBrowser = await playwright.launch({ executablePath, args: chromium.args, headless: true });
  try {
    const clean = await cleanBrowser.newContext(phoneOptions);
    await mockSites(clean);
    const freshPage = await clean.newPage();
    await freshPage.goto(`${base}/movie/${movie.slug}`, { waitUntil: "networkidle" });
    await freshPage.evaluate(() => { window.open = () => null; });
    await freshPage.getByRole("button", { name: /Own site renamed/ }).tap();
    await freshPage.getByTestId("copy-toast").getByText(/Your browser blocked the new tab/).waitFor();
    assert.equal(await countedIn(freshPage), null, "a blocked tab is not a confirmation opening");
    await freshPage.reload({ waitUntil: "networkidle" });
    const [firstEver] = await Promise.all([clean.waitForEvent("page"), freshPage.getByRole("button", { name: /Own site renamed/ }).tap()]);
    await firstEver.waitForURL(/\/copy$/, { timeout: 20000 });
    await firstEver.getByRole("heading", { name: "Link Copied Successfully!" }).waitFor();
    assert.equal(await countedIn(freshPage), "1", "and the first real confirmation is counted exactly once");
    await firstEver.close(); await clean.close();
  } finally { await cleanBrowser.close(); }

  assert.deepEqual(pageErrors, []); assert.deepEqual(visitorErrors, []);
  console.log("Copy Link E2E PASS: admin-only validated default website, per-link override, Link Behavior in the movie/quick-episode/bulk/wizard/archive/episode editors, bulk saves keep existing settings, mobile copy, the confirmation page shown only for the first two copies per browser (live 5,4,3,2,1 countdown, 5s redirect, Continue fallback, clean URL) then every later copy opening the website directly across other tabs, refreshes and a browser restart, blocked tabs and failed copies never spending a confirmation, none on failure or popup block, the shared toast, Open Link/R2/Telegram/magnet unchanged, persistence across reload/logout/content edits, explicit removal back to copy-only.");
} finally { await phone?.close(); await browser?.close(); await pool.end(); }
