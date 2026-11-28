import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import webpush from "web-push";
import { vapidConfig } from "./push-config";
import { safePushRoute } from "./push-validation";

const MAX_ATTEMPTS = 6;
const MAX_SENDS = 12;

type Delivery = {
  id: number;
  lease_token: string;
  attempts: number;
  subscription_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  media_type: string;
  slug: string;
  episode_id: number;
  title: string;
  season_number: number;
  episode_number: number;
  following: boolean;
  deleted: boolean;
};

async function claim(pool: Pool): Promise<Delivery | null> {
  const lease = randomUUID();
  const response = await pool.query([
    "WITH next_job AS (",
    " SELECT d.id FROM push_deliveries d",
    " WHERE d.sent_at IS NULL AND d.attempts < $2 AND d.retry_at <= now()",
    " AND (d.locked_until IS NULL OR d.locked_until < now())",
    " ORDER BY d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED",
    "), claimed AS (",
    " UPDATE push_deliveries d SET attempts=d.attempts+1,",
    " locked_until=now()+interval '35 seconds', lease_token=$1",
    " WHERE d.id=(SELECT id FROM next_job) RETURNING d.*",
    ")",
    "SELECT c.id,c.lease_token,c.attempts,c.subscription_id,s.endpoint,s.p256dh,s.auth,",
    " p.episode_id,p.title,p.season_number,p.episode_number,m.type AS media_type,m.slug,",
    " EXISTS(SELECT 1 FROM anime_follows f WHERE f.subscriber_id=s.subscriber_id",
    " AND f.media_id=p.media_id) AS following,",
    " EXISTS(SELECT 1 FROM content_state t WHERE t.kind='media'",
    " AND t.content_id=p.media_id AND t.deleted_at IS NOT NULL)",
    " OR EXISTS(SELECT 1 FROM content_state t WHERE t.kind='episode'",
    " AND t.content_id=p.episode_id AND t.deleted_at IS NOT NULL) AS deleted",
    "FROM claimed c JOIN push_subscriptions s ON s.id=c.subscription_id",
    "JOIN episode_notifications n ON n.id=c.notification_id",
    "JOIN episode_publications p ON p.episode_id=n.episode_id",
    "JOIN media m ON m.id=p.media_id",
  ].join(" "), [lease, MAX_ATTEMPTS]);
  return (response.rows[0] as Delivery | undefined) ?? null;
}

function retryAfter(attempts: number) {
  return Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1)));
}

/** Claims leases atomically; no network request is made while holding a SQL transaction. */
export async function drainPushQueue(pool: Pool, deadline: number) {
  const config = vapidConfig();
  if (!config) return { sent: 0, attempted: 0 };
  const ready = await pool.query("SELECT to_regclass('push_subscriptions') IS NOT NULL AND to_regclass('push_deliveries') IS NOT NULL AS ready");
  if (ready.rows[0]?.ready !== true) return { sent: 0, attempted: 0 };
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  let sent = 0, attempted = 0;
  // Delivery is at-least-once on ambiguous HTTP failures; the stable notification tag
  // coalesces duplicates on a device, and durable rows block normal replays.
  while (attempted < MAX_SENDS && Date.now() + 1000 < deadline) {
    const job = await claim(pool);
    if (!job) break;
    attempted++;
    if (!job.following || job.deleted) {
      await pool.query("DELETE FROM push_deliveries WHERE id=$1 AND lease_token=$2", [job.id, job.lease_token]);
      continue;
    }
    const destination = safePushRoute(job.media_type, job.slug, job.episode_id);
    const payload = JSON.stringify({
      id: job.id, title: String(job.title).slice(0, 100),
      season: job.season_number, episode: job.episode_number, url: destination,
    });
    try {
      await webpush.sendNotification({
        endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth },
      }, payload, { TTL: 86400, timeout: 5000, urgency: "normal" });
      await pool.query("UPDATE push_deliveries SET sent_at=now(),locked_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2", [job.id, job.lease_token]);
      sent++;
    } catch (cause) {
      const status = (cause as { statusCode?: number } | null)?.statusCode;
      if (status === 404 || status === 410) {
        await pool.query("DELETE FROM push_subscriptions WHERE id=$1", [job.subscription_id]);
      } else {
        await pool.query([
          "UPDATE push_deliveries SET locked_until=NULL,lease_token=NULL,",
          "retry_at=now()+($3*interval '1 second')",
          "WHERE id=$1 AND lease_token=$2",
        ].join(" "), [job.id, job.lease_token, retryAfter(job.attempts)]);
      }
      // Provider error objects may contain private endpoint capability URLs; never log them.
      console.error("Background push delivery deferred", status && [400, 401, 403, 404, 410, 429, 500, 502, 503].includes(status) ? status : "provider");
    }
  }
  // Bound retention of successful pushes without touching in-site notification history.
  await pool.query([
    "DELETE FROM push_deliveries WHERE id IN",
    "(SELECT id FROM push_deliveries WHERE sent_at < now()-interval '30 days' LIMIT 200)",
  ].join(" "));
  return { sent, attempted };
}
