import { pool } from "@/db";
import { activeRaw, lifecycleReady } from "@/lib/content-state";
import { cleanVaultFollows } from "@/lib/library-backup";
import { notificationError, notificationRateLimit, privateJson, subscriber } from "@/lib/notifications/session";
import { ApiError, readJson } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Restores only active Vault title follows to this anonymous browser identity.
 * Existing follows are never removed; a saved watch status can be updated.
 */
export async function POST(request: Request) {
  try {
    const session = await subscriber(request);
    await notificationRateLimit(request, "restore:" + session.id, 8, 3600);
    const body = await readJson(request, 131072);
    if (!Array.isArray(body.follows) || body.follows.length > 500) {
      throw new ApiError(400, "Choose a backup with at most 500 followed titles.");
    }
    const follows = cleanVaultFollows(body.follows);
    if (follows.length !== body.follows.length) {
      throw new ApiError(400, "Backup contains duplicate or invalid followed titles.");
    }
    if (!follows.length) return privateJson({ imported: 0, unavailable: 0 });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A subscriber-level lock makes the existing 500-title cap race-safe.
      await client.query("SELECT id FROM subscribers WHERE id=$1 FOR UPDATE", [session.id]);
      const isActive = activeRaw("media", "m.id", await lifecycleReady());
      const available = await client.query(
        "SELECT m.id FROM media m WHERE m.id=ANY($1::integer[]) AND m.type IN ('anime','movie','series') AND " + isActive,
        [follows.map((item) => item.id)],
      );
      const validIds = new Set<number>(available.rows.map((row) => Number(row.id)));
      const restorable = follows.filter((item) => validIds.has(item.id));
      const saved = await client.query("SELECT media_id FROM anime_follows WHERE subscriber_id=$1", [session.id]);
      const existing = new Set<number>(saved.rows.map((row) => Number(row.media_id)));
      const newFollows = restorable.filter((item) => !existing.has(item.id)).length;
      if (existing.size + newFollows > 500) {
        throw new ApiError(409, "Restoring would exceed 500 followed titles. Unfollow some titles first.");
      }
      if (restorable.length) {
        await client.query(
          `INSERT INTO anime_follows (subscriber_id,media_id,watch_status)
           SELECT $1, item.id, item.status
           FROM jsonb_to_recordset($2::jsonb) AS item(id integer, status text)
           WHERE true
           ON CONFLICT (subscriber_id,media_id)
           DO UPDATE SET watch_status=EXCLUDED.watch_status`,
          [session.id, JSON.stringify(restorable.map((item) => ({ id: item.id, status: item.watchStatus })))],
        );
      }
      await client.query("COMMIT");
      return privateJson({ imported: restorable.length, unavailable: follows.length - restorable.length });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return notificationError(error);
  }
}
