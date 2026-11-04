import "server-only";
import { createHash, randomUUID } from "node:crypto";
import webpush from "web-push";
import { pool } from "@/db";
import { decryptSubscription, pushConfigured } from "./subscription-crypto";
import { drainFanout } from "./fanout";
import { pushFailure, retryDelay } from "./validation";

type Delivery = { id: number; notification_id: number; subscription_id: number; attempts: number; lease_token: string; encrypted: string; title: string; episode_number: number; episode_title: string | null; season_number: number; url: string };
async function claim(): Promise<Delivery[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = randomUUID();
    const claimed = await client.query(`WITH due AS (
      SELECT id FROM push_deliveries WHERE state='pending' AND next_attempt<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE push_deliveries d SET lease_until=now()+interval '2 minutes',lease_token=$1,attempts=attempts+1 FROM due WHERE d.id=due.id RETURNING d.*`, [token]);
    const rows: Delivery[] = [];
    for (const job of claimed.rows) {
      const selected = await client.query(`SELECT s.encrypted,p.title,p.episode_number,p.episode_title,p.season_number,p.url FROM episode_notifications n
        JOIN episode_publications p ON p.episode_id=n.episode_id JOIN push_subscriptions s ON s.id=$2 AND s.subscriber_id=n.subscriber_id
        JOIN anime_follows f ON f.subscriber_id=n.subscriber_id AND f.media_id=p.media_id WHERE n.id=$1`, [job.notification_id, job.subscription_id]);
      if (!selected.rowCount) await client.query("UPDATE push_deliveries SET state='cancelled',lease_until=NULL,lease_token=NULL WHERE id=$1", [job.id]);
      else rows.push({ ...job, ...selected.rows[0] });
    }
    await client.query("COMMIT");
    return rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function deliver(job: Delivery): Promise<void> {
  let status: number | undefined;
  try {
    // Recheck before network I/O: disabling push removes the row/jobs; unfollow
    // suppresses deliveries still queued for this title.
    const active = await pool.query(`SELECT 1 FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id
      JOIN episode_notifications n ON n.id=d.notification_id JOIN episode_publications p ON p.episode_id=n.episode_id
      JOIN anime_follows f ON f.subscriber_id=n.subscriber_id AND f.media_id=p.media_id WHERE d.id=$1 AND d.lease_token=$2 AND d.state='pending'`, [job.id, job.lease_token]);
    if (!active.rowCount) return;
    const subscription = decryptSubscription(job.encrypted);
    const payload = JSON.stringify({ title: job.title, body: `Season ${job.season_number} · Episode ${job.episode_number}${job.episode_title ? ` — ${job.episode_title}` : ""}`, url: job.url, notificationId: job.notification_id });
    await webpush.sendNotification(subscription, payload, {
      vapidDetails: { subject: process.env.WEB_PUSH_SUBJECT!, publicKey: process.env.WEB_PUSH_PUBLIC_KEY!, privateKey: process.env.WEB_PUSH_PRIVATE_KEY! },
      TTL: 86400, timeout: 8000, urgency: "normal",
      topic: createHash("sha256").update(`vault:${job.notification_id}`).digest("base64url").slice(0, 32),
    });
    await pool.query("UPDATE push_deliveries SET state='sent',lease_until=NULL,lease_token=NULL,last_status=201 WHERE id=$1 AND lease_token=$2", [job.id, job.lease_token]);
    return;
  } catch (error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    status = typeof code === "number" && Number.isInteger(code) ? code : undefined;
    // Never log push endpoint, keys, subscription ciphertext or provider bodies.
  }
  const outcome = pushFailure(status, job.attempts);
  if (outcome === "expired") {
    // Delete only the exact subscription version; a concurrent renewal has a new ID.
    await pool.query("DELETE FROM push_subscriptions WHERE id=$1", [job.subscription_id]);
  } else {
    await pool.query(`UPDATE push_deliveries SET state=$3,lease_until=NULL,lease_token=NULL,last_status=$4,next_attempt=now()+($5*interval '1 second') WHERE id=$1 AND lease_token=$2`, [job.id, job.lease_token, outcome, status ?? null, retryDelay(job.attempts)]);
  }
}
export async function processNotifications() {
  const deadline = Date.now() + 18000;
  await pool.query("DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at<now()-interval '1 day' LIMIT 500)");
  const notifications = await drainFanout(pool, deadline);
  if (!pushConfigured()) return { notifications, deliveries: 0, pushConfigured: false };
  let deliveries = 0;
  // Drain small backlogs immediately without unbounded work on a serverless
  // invocation. Leases/outbox retain the remainder for cron or later traffic.
  while (deliveries < 200 && Date.now() < deadline) {
    const jobs = await claim();
    if (!jobs.length) break;
    await Promise.all(jobs.map(deliver));
    deliveries += jobs.length;
  }
  const remaining = await pool.query("SELECT EXISTS (SELECT 1 FROM episode_publications WHERE processed_at IS NULL) OR EXISTS (SELECT 1 FROM push_deliveries WHERE state='pending') AS pending");
  return { notifications, deliveries, pushConfigured: true, pending: remaining.rows[0].pending };
}
export async function safelyProcessNotifications() {
  try { return await processNotifications(); }
  catch (error) { console.error("Notification worker deferred", (error as { code?: string }).code || "unavailable"); }
}
