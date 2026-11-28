import "server-only";
import { pool } from "@/db";
import { drainFanout } from "./fanout";
import { drainPushQueue } from "./push-worker";
import { requireNotificationsReady } from "./readiness";

export async function processNotifications() {
  await requireNotificationsReady();
  const deadline = Date.now() + 18000;
  await pool.query("DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at<now()-interval '1 day' LIMIT 500)");
  const notifications = await drainFanout(pool, deadline);
  const remaining = await pool.query("SELECT EXISTS (SELECT 1 FROM episode_publications WHERE processed_at IS NULL) AS pending");
  let pushSent = 0;
  try { pushSent = (await drainPushQueue(pool, deadline)).sent; }
  catch { console.error("Optional background push worker deferred"); }
  return { notifications, pending: remaining.rows[0].pending, pushSent };
}
export async function safelyProcessNotifications() {
  try { return await processNotifications(); }
  catch { console.error("In-site notification worker deferred; durable work remains retryable"); }
}
