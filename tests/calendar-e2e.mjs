// Browser + real API calendar regression against disposable E2E PostgreSQL only.
import assert from "node:assert/strict";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Never run calendar E2E against a public deployment");
const password = process.env.E2E_ADMIN_PASSWORD || "test-admin-password";

const stamp = Date.now().toString(36);
const title = "Calendar E2E " + stamp;
const today = new Date(Date.now() + 86_400_000);
const year = today.getUTCFullYear(), month = today.getUTCMonth() + 1;
const start = new Date(Date.UTC(year, month - 1, Math.min(today.getUTCDate(), 24), 10, 30));
const later = new Date(start.getTime() + 86_400_000);
const dateKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" })
  .formatToParts(date).filter((p) => ["year", "month", "day"].includes(p.type)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
const dayStr = (date) => { const x = dateKey(date); return [x.year, x.month, x.day].join("-"); };
const expectedDay = dayStr(start);
let browser;
try {
  const unauth = await fetch(base + "/api/admin/calendar");
  assert.equal(unauth.status, 401, "Public cannot read admin schedules");
  const unauthEdit = await fetch(base + "/api/admin/calendar", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ title }) });
  assert.equal(unauthEdit.status, 401, "Public cannot write calendar schedule");

  const invalidAnimeSearch = await fetch(base + "/api/calendar-search?q=x");
  assert.equal(invalidAnimeSearch.status, 400, "Short anime search must be rejected without contacting AniList");

  const defaultCalendar = await fetch(base + "/api/calendar?year=" + year + "&month=" + month);
  assert.equal(defaultCalendar.status, 200, "Public calendar API works");
  const defaultPayload = await defaultCalendar.json();
  assert.equal(defaultPayload.anilistStatus, "disabled", "Disposable tests never fetch remote AniList");
  assert.equal(defaultPayload.timeZone, "Asia/Karachi");

  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br"));
  setupLambdaEnvironment("/tmp/al2023/lib");
  const executablePath = await chromium.executablePath();
  browser = await playwright.launch({ executablePath, args: chromium.args, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.240" } });
  const page = await context.newPage();
  const crashes = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base + "/admin", { waitUntil: "networkidle" });
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Admin Dashboard" }).waitFor();
  await page.getByRole("button", { name: "Release Calendar" }).click();
  await page.getByRole("heading", { name: "Add release" }).waitFor();
  await page.getByLabel("Anime / release title").fill(title);
  await page.getByLabel("Release type").selectOption("episode");
  await page.getByLabel("Date and time (your device local time)").fill(start.toISOString().slice(0, 16));
  await page.getByLabel("Episode number").fill("8");
  await page.getByLabel("AniList anime ID (optional)").fill("123456");
  await page.getByLabel("Extra details (optional)").fill("E2E fixture");
  await page.getByRole("button", { name: "Add to calendar" }).click();
  await page.getByText("Release added to calendar.").waitFor();
  await page.getByText(title, { exact: true }).waitFor();
  const adminGet = await page.evaluate(async () => {
    const response = await fetch("/api/admin/calendar", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(adminGet.status, 200);
  const entry = adminGet.body.entries.find((e) => e.title === title);
  assert.ok(entry && entry.episode === 8 && entry.anilistId === 123456, "Created entry persists in database");
  const publicResponse = await fetch(base + "/api/calendar?year=" + year + "&month=" + month);
  const publicEvents = (await publicResponse.json()).events;
  assert.ok(publicEvents.some((e) => e.id === "manual:" + entry.id && e.episode === 8), "Saved entry appears in public month API");

  await page.goto(base + "/calendar", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Release Calendar" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Calendar fits 390px viewport");
  const searchOnlyTitle = "Search-only Anime " + stamp;
  const searchOnlyId = 1987654;
  await page.route("**/api/calendar-search?*", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ results: [{
      id: searchOnlyId, title: searchOnlyTitle, posterUrl: null, totalEpisodes: null, nextAiring: null,
    }] }),
  }));
  await page.getByRole("searchbox", { name: "Search any anime to follow" }).fill(searchOnlyTitle);
  await page.getByRole("button", { name: "Follow " + searchOnlyTitle }).click();
  await page.getByRole("button", { name: "Unfollow " + searchOnlyTitle }).waitFor();
  assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem("vault-calendar-follows-v1") || "[]")))
    .some((item) => item.source === "anilist" && item.externalId === searchOnlyId), "Search-only anime persists even without a monthly release");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "Search any anime to follow" }).fill(searchOnlyTitle);
  await page.getByRole("button", { name: "Unfollow " + searchOnlyTitle }).waitFor();
  await page.getByRole("button", { name: "Unfollow " + searchOnlyTitle }).click();
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("vault-calendar-follows-v1") || "[]")))
    .some((item) => item.externalId === searchOnlyId), false, "Unfollow removes searched anime from browser storage");

  await page.getByRole("button", { name: new RegExp(expectedDay + ", ") }).click();
  await page.getByRole("heading", { name: title }).waitFor();
  await page.getByText("Episode 8", { exact: false }).waitFor();

  await page.goto(base + "/admin", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Release Calendar" }).click();
  const item = page.getByText(title, { exact: true });
  await item.waitFor();
  await item.locator("xpath=../..").getByRole("button", { name: "Edit" }).click();
  await page.getByRole("heading", { name: "Edit release" }).waitFor();
  await page.getByLabel("Episode number").fill("9");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Release updated.").waitFor();
  const updatedResponse = await page.evaluate(async () => (await fetch("/api/admin/calendar", { cache: "no-store" })).json());
  assert.equal(updatedResponse.entries.find((e) => e.id === entry.id).episode, 9, "Admin edit persisted");
  const row = page.getByText(title, { exact: true }).locator("xpath=../..");
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByText("Release deleted.").waitFor();
  const afterDelete = await page.evaluate(async () => (await fetch("/api/admin/calendar", { cache: "no-store" })).json());
  assert.equal(afterDelete.entries.some((e) => e.id === entry.id), false, "Admin delete persisted");
  const publicAfterDelete = (await (await fetch(base + "/api/calendar?year=" + year + "&month=" + month)).json()).events;
  assert.equal(publicAfterDelete.some((e) => e.id === "manual:" + entry.id), false, "Deleted release removed from public calendar");
  assert.deepEqual(crashes, [], "No browser runtime errors");
  console.log("Calendar E2E PASS: admin auth, add/edit/delete, DB persistence, public schedule, day selection and mobile layout.");
} finally {
  await browser?.close();
}
