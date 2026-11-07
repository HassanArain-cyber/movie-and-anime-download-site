// Global-delete regressions run LAST in the disposable suite. Never a live DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
const database = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
for (const url of [base, database]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Delete All E2E refuses remote services");
const pool = new pg.Pool({ connectionString: database, max: 3 });
let cookie = "", browser, mediaId;
async function api(url, method = "GET", body, headers = {}) {
  const response = await fetch(`${base}${url}`, { method, redirect: "manual", headers: { Cookie: cookie, "x-e2e-client-ip": "198.51.100.234", ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  for (const value of response.headers.getSetCookie()) cookie = value.split(";")[0];
  const data = await response.json(); return { response, data };
}
const count = async (table) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const protectedTables = ["media", "seasons", "episodes", "download_links", "site_settings", "r2_uploads", "content_state"];
const snapshot = async () => Object.fromEntries(await Promise.all(protectedTables.map(async (table) => [table, (await pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM ${table} t`)).rows[0].digest])));
try {
  for (const route of ["/api/admin/comments", "/api/contact/requests"]) assert.equal((await api(route, "DELETE", { confirm: true })).response.status, 401);
  assert.equal((await api("/api/auth/login", "POST", { password: process.env.E2E_ADMIN_PASSWORD || "test-admin-password" })).response.status, 200);
  const key = `delete-all-${randomUUID()}`;
  mediaId = (await pool.query("INSERT INTO media(type,title,slug) VALUES ('anime',$1,$1) RETURNING id", [key])).rows[0].id;
  const seasonId = (await pool.query("INSERT INTO seasons(media_id,season_number) VALUES ($1,1) RETURNING id", [mediaId])).rows[0].id;
  const episodeId = (await pool.query("INSERT INTO episodes(media_id,season_id,episode_number) VALUES ($1,$2,1) RETURNING id", [mediaId, seasonId])).rows[0].id;
  await pool.query("INSERT INTO download_links(media_id,episode_id,url) VALUES ($1,$2,'https://example.com/retained')", [mediaId, episodeId]);
  const inserted = (await pool.query("INSERT INTO comments(media_id,episode_id,author_hash,body,is_hidden) SELECT $1,$2,repeat('a',64),'Bulk comment '||n,(n%2=0) FROM generate_series(1,511) n RETURNING id", [mediaId, episodeId])).rows;
  let parent = inserted[0].id;
  for (let n = 0; n < 12; n++) parent = (await pool.query("INSERT INTO comments(media_id,episode_id,parent_id,author_hash,body) VALUES ($1,$2,$3,repeat('b',64),$4) RETURNING id", [mediaId, episodeId, parent, `Nested ${n}`])).rows[0].id;
  await pool.query("INSERT INTO comment_likes(comment_id,session_hash) VALUES ($1,repeat('c',64))", [parent]);
  await pool.query("INSERT INTO comment_reports(comment_id,reporter_hash,reason) VALUES ($1,repeat('d',64),'spam')", [parent]);
  await pool.query("INSERT INTO contact_requests(name,request_type,message) SELECT 'Bulk request '||n,'Anime','Disposable request' FROM generate_series(1,1005) n");
  const before = await snapshot();
  for (const route of ["/api/admin/comments", "/api/contact/requests"]) {
    assert.equal((await api(route, "DELETE", {})).response.status, 400);
    assert.equal((await api(route, "DELETE", { confirm: false })).response.status, 400);
    assert.equal((await api(route, "DELETE", { confirm: true }, { Origin: "https://attacker.invalid" })).response.status, 403);
  }
  assert.ok(await count("comments") >= 523); assert.ok(await count("contact_requests") >= 1005);
  assert.equal((await api("/api/admin/comments?view=all")).data.comments.length, 200, "listing is capped; deletion must not be");
  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br")); setupLambdaEnvironment("/tmp/al2023/lib");
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-e2e-client-ip": "198.51.100.235" } });
  const page = await context.newPage(), errors = []; let accept = false, lastDialog;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => { lastDialog = { type: dialog.type(), message: dialog.message() }; return accept ? dialog.accept() : dialog.dismiss(); });
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Password", { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD || "test-admin-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  for (const [kind, table, tab, heading] of [["comments", "comments", "Comment moderation", "Comment moderation"], ["requests", "contact_requests", "requests", "Submitted requests"]]) {
    await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: tab, exact: true }).click();
    const section = page.getByRole("region", { name: heading, exact: true }), button = section.getByRole("button", { name: "Delete All", exact: true });
    const beforeCount = await count(table);
    accept = false; await button.click();
    assert.deepEqual(lastDialog, { type: "confirm", message: `Are you sure you want to permanently delete all ${kind}?` });
    assert.equal(await count(table), beforeCount, "Cancel retains all records");
    accept = true; await button.click();
    await section.getByRole("status").filter({ hasText: `Deleted ${beforeCount} ${kind}.` }).waitFor();
    await section.getByText(kind === "comments" ? "No reports in this queue." : "No requests have been submitted yet.", { exact: true }).waitFor();
    assert.equal(await count(table), 0);
    if (kind === "comments") {
      assert.equal(await count("comment_likes"), 0); assert.equal(await count("comment_reports"), 0);
      assert.ok(await count("contact_requests") >= 1005, "comments deletion cannot delete requests");
      await section.getByLabel("Moderation view").selectOption("comments");
      await section.getByText("No comments to moderate.", { exact: true }).waitFor();
    }
    assert.deepEqual(await snapshot(), before, "media, episodes, links, Wallpaper, R2 audit and lifecycle markers remain byte-structurally unchanged");
  }
  assert.deepEqual(errors, []);
  console.log("Delete All real PostgreSQL/browser PASS: cancelled operations, unauthorized/cross-site/unconfirmed rejection, >523 comments including hidden/deep replies and likes/reports, >1005 requests, successful list refresh, complete collection deletion beyond 200-row cap, unrelated tables unchanged.");
} finally {
  await browser?.close();
  if (mediaId) await pool.query("DELETE FROM media WHERE id=$1", [mediaId]);
  await pool.end();
}
