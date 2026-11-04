import type { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";

const RECIPIENT_BATCH_SIZE = 500;
const MAX_BATCHES = 20;

/** One publication page per transaction: a later failure cannot undo earlier
 * committed pages, and notifications + their push jobs always commit together.
 * The unique notification rows are the durable cursor; never OFFSET a shrinking
 * NOT EXISTS result set, or advance a cursor independently of its inserts.
 */
async function fanoutBatch(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const events = await client.query(`SELECT * FROM episode_publications WHERE processed_at IS NULL ORDER BY published_at,episode_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const event = events.rows[0];
    if (!event) {
      await client.query("COMMIT");
      return { claimed: false, notifications: 0 };
    }
    const inserted = await client.query(`INSERT INTO episode_notifications (subscriber_id,episode_id)
      SELECT f.subscriber_id,$1 FROM anime_follows f JOIN episode_publications p ON p.episode_id=$1
      WHERE f.media_id=p.media_id AND f.created_at<=p.published_at
      AND NOT EXISTS (SELECT 1 FROM episode_notifications n WHERE n.subscriber_id=f.subscriber_id AND n.episode_id=$1)
      ORDER BY f.subscriber_id LIMIT $2 ON CONFLICT DO NOTHING RETURNING id`, [event.episode_id, RECIPIENT_BATCH_SIZE]);
    await client.query(`INSERT INTO push_deliveries (notification_id,subscription_id)
      SELECT n.id,s.id FROM episode_notifications n JOIN push_subscriptions s ON s.subscriber_id=n.subscriber_id
      JOIN episode_publications p ON p.episode_id=n.episode_id
      WHERE n.id=ANY($1::int[]) AND s.created_at<=p.published_at ON CONFLICT DO NOTHING`, [inserted.rows.map((row) => row.id)]);
    // Completion is an explicit absence of outstanding recipients, not a row
    // count heuristic (which is ambiguous at exact boundaries/conflicts).
    await client.query(`UPDATE episode_publications p SET processed_at=now() WHERE p.episode_id=$1
      AND NOT EXISTS (SELECT 1 FROM anime_follows f WHERE f.media_id=p.media_id AND f.created_at<=p.published_at
        AND NOT EXISTS (SELECT 1 FROM episode_notifications n WHERE n.subscriber_id=f.subscriber_id AND n.episode_id=p.episode_id))`, [event.episode_id]);
    await client.query("COMMIT");
    return { claimed: true, notifications: inserted.rowCount || 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Drain multiple pages within the invocation's existing deadline/work budget.
 * An empty SKIP LOCKED result does NOT mean the queue is empty: another worker
 * may own its only event. Recheck pending work and briefly yield, without holding
 * a connection/transaction, so concurrent retry calls don't falsely report done.
 */
export async function drainFanout(pool: Pool, deadline: number, maxBatches = MAX_BATCHES) {
  let notifications = 0, batches = 0, waitMs = 25;
  while (batches < maxBatches && Date.now() < deadline) {
    const result = await fanoutBatch(pool);
    if (result.claimed) {
      notifications += result.notifications;
      batches++;
      waitMs = 25;
      continue;
    }
    const pending = await pool.query("SELECT EXISTS (SELECT 1 FROM episode_publications WHERE processed_at IS NULL) AS pending");
    if (!pending.rows[0].pending) break;
    await delay(Math.max(0, Math.min(waitMs, deadline - Date.now())));
    waitMs = Math.min(250, waitMs * 2);
  }
  return notifications;
}
