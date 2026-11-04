// Real database + API + encrypted Web Push transport + browser workflow. Every
// mutating target is loopback; no production database or push provider is used.
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";
import { chromium as playwright } from "playwright-core";
import chromium, { inflate, setupLambdaEnvironment } from "@sparticuz/chromium";
import path from "node:path";
const require = createRequire(import.meta.url), ece = require("http_ece");
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3001";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
for (const url of [base, dbUrl]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Notifications E2E refuses non-loopback targets");
const pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
const run = Date.now().toString(36);
function client(ip) {
  let cookie = "";
  const call = async (url, method = "GET", body, headers = {}) => {
    const res = await fetch(`${base}${url}`, { method, headers: { "x-e2e-client-ip": ip, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const cookies = res.headers.getSetCookie();
    for (const next of cookies) {
      const name = next.split("=")[0];
      cookie = [...cookie.split("; ").filter((old) => old && !old.startsWith(`${name}=`)), next.split(";")[0]].join("; ");
    }
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { res, data, cookie };
  };
  return call;
}
const admin = client("198.51.100.211"), a = client("198.51.100.212"), b = client("198.51.100.213");
function ok(r, status = 200) { assert.equal(r.res.status, status, `${r.res.url}: ${JSON.stringify(r.data)}`); return r.data; }
const job = async () => ok(await admin("/api/internal/notifications", "GET", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));
const provider = async (route, body) => { const res = await fetch(`http://127.0.0.1:9002${route}`, { method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }); return res.json(); };
async function eventually(fn, message) { const deadline = Date.now() + 12000; let result; while (Date.now() < deadline) { result = await fn(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 100)); } assert.fail(message); }
let browser;
try {
  await provider("/reset");
  ok(await admin("/api/auth/login", "POST", { password: process.env.E2E_ADMIN_PASSWORD || "test-admin-password" }));
  const first = await a("/api/updates"); ok(first);
  assert.match(first.res.headers.get("set-cookie"), /HttpOnly/i); assert.match(first.res.headers.get("set-cookie"), /SameSite=lax/i);
  assert.match(first.res.headers.get("cache-control"), /no-store/); assert.equal(first.data.publicKey, process.env.WEB_PUSH_PUBLIC_KEY);
  assert.ok(!JSON.stringify(first.data).includes(process.env.WEB_PUSH_PRIVATE_KEY));
  ok(await b("/api/updates"));
  const media = ok(await admin("/api/media", "POST", { type: "anime", title: `Notification Anime ${run}`, slug: `notification-anime-${run}` }), 201);
  const season = ok(await admin("/api/seasons", "POST", { mediaId: media.id, seasonNumber: 1 }), 201);
  const episode = async (number) => ok(await admin("/api/episodes", "POST", { mediaId: media.id, seasonId: season.id, episodeNumber: number, title: `Episode title ${number}` }), 201);
  const link = async (ep, quality = "720p") => ok(await admin("/api/download-links", "POST", { mediaId: media.id, seasonId: season.id, episodeId: ep.id, quality, url: `https://example.com/${run}/${ep.id}/${quality}` }), 201);
  const ep = await episode(1);
  assert.equal((await pool.query("SELECT * FROM episode_publications WHERE episode_id=$1", [ep.id])).rowCount, 0, "placeholders never publish");
  ok(await a("/api/follows", "POST", { mediaId: media.id }));
  await Promise.all([a("/api/follows", "POST", { mediaId: media.id }), a("/api/follows", "POST", { mediaId: media.id })]);
  assert.equal((await a("/api/updates")).data.following.filter((m) => m.id === media.id).length, 1, "concurrent follows deduplicate");
  assert.equal((await b("/api/updates")).data.following.length, 0, "browser identities stay private");
  assert.equal((await a("/api/follows", "POST", { mediaId: media.id }, { Origin: "https://evil.example", "sec-fetch-site": "cross-site" })).res.status, 403);
  const key = createECDH("prime256v1"); key.generateKeys(); const auth = randomBytes(16);
  const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/vault-e2e-${run}`, keys: { p256dh: key.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  ok(await a("/api/push-subscription", "POST", subscription));
  ok(await a("/api/push-subscription", "POST", subscription));
  assert.equal((await b("/api/push-subscription", "POST", subscription)).res.status, 409, "another subscriber cannot steal a push subscription");
  assert.equal((await a("/api/push-subscription", "POST", { ...subscription, endpoint: "https://127.0.0.1/private" })).res.status, 400);
  const saved = (await pool.query("SELECT * FROM push_subscriptions WHERE endpoint_hash IS NOT NULL")).rows;
  const sub = saved.find((s) => !s.encrypted.includes(subscription.endpoint)); assert.ok(sub);
  assert.ok(saved.every((s) => !s.encrypted.includes(subscription.keys.auth)));
  await provider("/mode", { status: 503 });
  const start = Date.now(); const primaryLink = await link(ep); assert.ok(Date.now() - start < 10000, "publishing does not wait for delivery success");
  await job();
  const inbox = await eventually(async () => { const result = ok(await a("/api/updates")); return result.notifications.find((n) => n.url.endsWith(`#episode-${ep.id}`)) ? result : null; }, "first usable link creates in-site alert");
  assert.equal(inbox.unread, 1); assert.equal(inbox.notifications[0].title, media.title); assert.equal(inbox.notifications[0].episodeTitle, ep.title);
  assert.equal(inbox.following.find((m) => m.id === media.id).hasNew, true);
  const notification = inbox.notifications[0];
  const failed = await eventually(async () => { const row = (await pool.query("SELECT * FROM push_deliveries WHERE notification_id=$1", [notification.id])).rows[0]; return row?.last_status === 503 ? row : null; }, "503 push response creates a retryable durable delivery");
  assert.equal(failed.state, "pending"); assert.equal(failed.attempts, 1); assert.equal((await b("/api/updates")).data.notifications.length, 0);
  assert.equal((await b("/api/notifications", "PATCH", { id: notification.id })).res.status, 404);
  await provider("/mode", { status: 201 });
  await pool.query("UPDATE push_deliveries SET next_attempt=now()-interval '1 second' WHERE id=$1", [failed.id]);
  await Promise.all([job(), job(), job()]);
  assert.equal((await pool.query("SELECT state FROM push_deliveries WHERE id=$1", [failed.id])).rows[0].state, "sent");
  const delivered = (await provider("/state")).requests;
  assert.equal(delivered.length, 2, "one failed attempt plus one successful retry despite concurrent workers");
  const clear = JSON.parse(ece.decrypt(Buffer.from(delivered.at(-1).body, "base64"), { version: "aes128gcm", privateKey: key, authSecret: auth }).toString());
  assert.equal(clear.notificationId, notification.id); assert.equal(clear.url, `/anime/${media.slug}#episode-${ep.id}`);
  assert.equal(delivered.at(-1).headers["content-encoding"], "aes128gcm"); assert.match(delivered.at(-1).headers.authorization, /^vapid /);
  const secondaryLink = await link(ep, "1080p");
  ok(await admin(`/api/download-links/${primaryLink.id}`, "PATCH", { url: `https://example.com/edited-${run}` }));
  await job();
  assert.equal((await a("/api/updates")).data.notifications.length, 1, "extra quality and editing a link never republish");
  assert.equal((await provider("/state")).requests.length, 2);
  ok(await admin(`/api/download-links/${primaryLink.id}`, "DELETE"));
  ok(await admin(`/api/download-links/${secondaryLink.id}`, "DELETE"));
  await link(ep); await job();
  assert.equal((await a("/api/updates")).data.notifications.length, 1, "removal/re-add never republishes an episode");
  ok(await a("/api/notifications", "PATCH", { id: notification.id })); assert.equal((await a("/api/updates")).data.unread, 0);
  const ep2 = await episode(2);
  ok(await a("/api/push-subscription", "DELETE")); await link(ep2); await job();
  let updates = ok(await a("/api/updates")); assert.equal(updates.notifications.length, 2); assert.equal(updates.pushEnabled, false); assert.equal((await provider("/state")).requests.length, 2);
  ok(await a("/api/push-subscription", "POST", subscription)); await job(); assert.equal((await provider("/state")).requests.length, 2, "enabling push does not send old alerts");
  await provider("/mode", { status: 410 }); const ep3 = await episode(3); await link(ep3); await job();
  await eventually(async () => (await a("/api/updates")).data.pushEnabled === false, "expired subscriptions are deleted");
  updates = ok(await a("/api/updates")); assert.equal(updates.notifications.length, 3, "expired push does not erase in-site history");
  ok(await a("/api/follows", "DELETE", { mediaId: media.id })); const ep4 = await episode(4); await link(ep4); await job();
  assert.equal((await a("/api/updates")).data.notifications.length, 3, "unfollow blocks future alerts");
  ok(await a("/api/notifications", "PATCH", { all: true })); assert.equal((await a("/api/updates")).data.unread, 0);
  assert.equal((await a("/api/internal/notifications")).res.status, 401);
  // Page older history is bounded and scoped even after unfollow.
  const older = ok(await a(`/api/notifications?before=${updates.notifications[0].id}`)); assert.equal(older.notifications.length, 2);
  assert.equal((await b(`/api/notifications?before=${updates.notifications[0].id}`)).data.notifications.length, 0);
  // First-link concurrency: two qualities commit, exactly one publication.
  ok(await a("/api/follows", "POST", { mediaId: media.id }));
  const ep5 = await episode(5); await Promise.all([link(ep5, "720p"), link(ep5, "1080p")]); await Promise.all([job(), job()]);
  assert.equal((await pool.query("SELECT * FROM episode_publications WHERE episode_id=$1", [ep5.id])).rowCount, 1);
  assert.equal((await pool.query("SELECT * FROM episode_notifications WHERE episode_id=$1", [ep5.id])).rowCount, 1);
  // A legacy invalid URL does not publish until PATCH supplies a usable link.
  const ep7 = await episode(7);
  const invalid = (await pool.query("INSERT INTO download_links (media_id,episode_id,url) VALUES ($1,$2,'javascript:alert(1)') RETURNING id", [media.id, ep7.id])).rows[0];
  assert.equal((await pool.query("SELECT 1 FROM episode_publications WHERE episode_id=$1", [ep7.id])).rowCount, 0);
  ok(await admin(`/api/download-links/${invalid.id}`, "PATCH", { url: "https://example.com/repaired-link" })); await job();
  assert.equal((await pool.query("SELECT 1 FROM episode_notifications WHERE episode_id=$1", [ep7.id])).rowCount, 1);
  // Private R2 metadata is also usable without treating r2:/// as an external URL.
  const ep8 = await episode(8);
  await pool.query("INSERT INTO download_links (media_id,episode_id,url,storage_provider,object_key,is_uploaded) VALUES ($1,$2,$3,'r2',$4,true)", [media.id, ep8.id, `r2:///e2e-${run}`, `e2e-${run}`]);
  await job(); assert.equal((await pool.query("SELECT 1 FROM episode_notifications WHERE episode_id=$1", [ep8.id])).rowCount, 1);
  // Bounded fanout resumes beyond the first 500 followers, without omissions.
  const subscriberIds = Array.from({ length: 510 }, () => randomBytes(32).toString("hex"));
  await pool.query("INSERT INTO subscribers (id) SELECT unnest($1::varchar[])", [subscriberIds]);
  await pool.query("INSERT INTO anime_follows (subscriber_id,media_id) SELECT unnest($1::varchar[]),$2", [subscriberIds, media.id]);
  const ep40 = await episode(40); await link(ep40); await job(); await job();
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM episode_notifications WHERE episode_id=$1", [ep40.id])).rows[0].count, 511);
  assert.equal((await pool.query("SELECT count(DISTINCT subscriber_id)::int AS count FROM episode_notifications WHERE episode_id=$1", [ep40.id])).rows[0].count, 511);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM anime_follows f JOIN episode_publications p ON p.media_id=f.media_id
    WHERE p.episode_id=$1 AND f.created_at<=p.published_at AND NOT EXISTS (SELECT 1 FROM episode_notifications n WHERE n.subscriber_id=f.subscriber_id AND n.episode_id=p.episode_id)`, [ep40.id])).rows[0].count, 0, "no eligible follower is omitted");
  assert.ok((await pool.query("SELECT processed_at FROM episode_publications WHERE episode_id=$1", [ep40.id])).rows[0].processed_at);
  await pool.query("DELETE FROM subscribers WHERE id=ANY($1::varchar[])", [subscriberIds]);
  // Terminal failures are observable and explicitly requeueable by the admin;
  // scheduled retries never resurrect an expired/disabled subscription.
  ok(await a("/api/push-subscription", "POST", subscription));
  await provider("/mode", { status: 503 }); const ep41 = await episode(41); await link(ep41); await job();
  const n41 = (await pool.query("SELECT id FROM episode_notifications WHERE episode_id=$1", [ep41.id])).rows[0];
  await eventually(async () => (await pool.query("SELECT last_status FROM push_deliveries WHERE notification_id=$1", [n41.id])).rows[0]?.last_status === 503, "transient failure must finish before exhausting attempts");
  await pool.query("UPDATE push_deliveries SET attempts=7,next_attempt=now()-interval '1 second' WHERE notification_id=$1", [n41.id]);
  await job(); assert.equal((await pool.query("SELECT state FROM push_deliveries WHERE notification_id=$1", [n41.id])).rows[0].state, "failed");
  await provider("/mode", { status: 201 });
  const replay = ok(await admin("/api/internal/notifications", "POST", { retryFailed: true })); assert.ok(replay.requeued >= 1);
  assert.equal((await pool.query("SELECT state FROM push_deliveries WHERE notification_id=$1", [n41.id])).rows[0].state, "sent");
  assert.equal((await pool.query("SELECT 1 FROM episode_notifications WHERE episode_id=$1", [ep41.id])).rowCount, 1);
  // Simulate a process dying after a durable claim, before network delivery.
  const currentSubscription = (await pool.query("SELECT id,subscriber_id FROM push_subscriptions WHERE endpoint_hash=$1", [createHash("sha256").update(subscription.endpoint).digest("hex")])).rows[0];
  const leasedJob = async (number) => {
    const pendingEpisode = await episode(number), transaction = await pool.connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query("INSERT INTO download_links (media_id,episode_id,url) VALUES ($1,$2,$3)", [media.id, pendingEpisode.id, `https://example.com/leased-${run}-${number}`]);
      const n = (await transaction.query("INSERT INTO episode_notifications (subscriber_id,episode_id) VALUES ($1,$2) RETURNING id", [currentSubscription.subscriber_id, pendingEpisode.id])).rows[0];
      const d = (await transaction.query("INSERT INTO push_deliveries (notification_id,subscription_id,attempts,lease_token,lease_until) VALUES ($1,$2,1,'dead-worker',now()+interval '2 minutes') RETURNING id", [n.id, currentSubscription.id])).rows[0];
      await transaction.query("COMMIT"); return { id: d.id, notificationId: n.id };
    } catch (e) { await transaction.query("ROLLBACK"); throw e; } finally { transaction.release(); }
  };
  const crashed = await leasedJob(42), beforeRecovery = (await provider("/state")).requests.length;
  await job(); assert.equal((await provider("/state")).requests.length, beforeRecovery, "a live lease cannot be stolen");
  await pool.query("UPDATE push_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1", [crashed.id]);
  await Promise.all([job(), job()]);
  const recovered = (await pool.query("SELECT state,attempts FROM push_deliveries WHERE id=$1", [crashed.id])).rows[0];
  assert.equal(recovered.state, "sent"); assert.equal(recovered.attempts, 2);
  assert.equal((await provider("/state")).requests.length, beforeRecovery + 1, "expired crash lease resumes once");
  const cancelled = await leasedJob(43);
  ok(await a("/api/follows", "DELETE", { mediaId: media.id }));
  await job(); assert.equal((await pool.query("SELECT state FROM push_deliveries WHERE id=$1", [cancelled.id])).rows[0].state, "cancelled");
  assert.equal((await provider("/state")).requests.length, beforeRecovery + 1, "unfollow cancels queued delivery");
  ok(await a("/api/push-subscription", "DELETE"));
  assert.equal((await pool.query("SELECT id FROM episode_notifications WHERE id=$1", [cancelled.notificationId])).rowCount, 1, "server revocation retains in-site history");
  const movie = ok(await admin("/api/media", "POST", { type: "movie", title: `No follow movie ${run}`, slug: `no-follow-movie-${run}` }), 201);
  assert.equal((await b("/api/follows", "POST", { mediaId: movie.id })).res.status, 400);
  const series = ok(await admin("/api/media", "POST", { type: "series", title: `Follow series ${run}`, slug: `follow-series-${run}` }), 201);
  ok(await b("/api/follows", "POST", { mediaId: series.id }));
  const seriesSeason = ok(await admin("/api/seasons", "POST", { mediaId: series.id, seasonNumber: 1 }), 201);
  const seriesEpisode = ok(await admin("/api/episodes", "POST", { mediaId: series.id, seasonId: seriesSeason.id, episodeNumber: 1 }), 201);
  ok(await admin("/api/download-links", "POST", { mediaId: series.id, episodeId: seriesEpisode.id, url: "https://example.com/series-episode" }), 201); await job();
  assert.equal((await b("/api/updates")).data.notifications[0].url, `/series/${series.slug}#episode-${seriesEpisode.id}`);
  // Browser: explicit permission click, follow persistence, bell/episode link,
  // preference disable and responsive overflow checks. Browser push APIs are
  // mocked here; actual encryption/transport is verified above.
  await inflate(path.resolve("node_modules/@sparticuz/chromium/bin/al2023.tar.br")); setupLambdaEnvironment("/tmp/al2023/lib");
  browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const browserSubscription = { ...subscription, endpoint: `https://fcm.googleapis.com/fcm/send/vault-e2e-browser-${run}` };
  await page.addInitScript(({ value }) => {
    window.permissionRequests = 0;
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: async () => { window.permissionRequests++; return "granted"; } } });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function() {} });
    const subscription = { options: {}, toJSON: () => value, unsubscribe: async () => true };
    const registration = { pushManager: { getSubscription: async () => null, subscribe: async () => subscription } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration } });
  }, { value: browserSubscription });
  await page.goto(`${base}/anime/${media.slug}`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.getByRole("button", { name: "+ Follow", exact: true }).click();
  await page.getByRole("button", { name: "✓ Following", exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" }); await page.getByRole("button", { name: "✓ Following", exact: true }).waitFor();
  await page.goto(`${base}/following`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.getByRole("button", { name: "Enable browser push", exact: true }).click();
  await page.getByRole("button", { name: "Disable browser push", exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.permissionRequests), 1);
  await provider("/mode", { status: 201 }); const ep6 = await episode(6); await link(ep6); await job();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("link", { name: "New episodes", exact: true }).waitFor();
  await page.getByLabel("Notifications, 1 unread", { exact: true }).click();
  await page.getByRole("region", { name: "Recent notifications" }).getByRole("link", { name: new RegExp(`Episode ${ep6.episodeNumber}`) }).click();
  await page.waitForURL(`**#episode-${ep6.id}`);
  await page.locator(`#episode-${ep6.id} button[aria-expanded="true"]`).waitFor();
  await page.goto(`${base}/following`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Disable browser push", exact: true }).click(); await page.getByRole("button", { name: "Enable browser push", exact: true }).waitFor();
  await page.getByRole("button", { name: "✓ Following", exact: true }).click(); await page.getByText("You are not following anything yet.", { exact: false }).waitFor();
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/following", "/notifications", `/anime/${media.slug}#episode-${ep6.id}`]) {
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflow at ${width}`);
      if (route.includes("#episode-")) await page.screenshot({ path: `test-results/notification-detail-${width}.png` });
    }
  }
  console.log("Notification E2E PASS: secure anonymous follows, publication/quality/concurrency dedup, scoped/paginated in-site history, encrypted VAPID transport, durable 503 retry, 410 cleanup, disable/history, unfollow, explicit permission, bell click and responsive 360/390/768/1280px.");
} finally { await browser?.close(); await pool.end(); }
