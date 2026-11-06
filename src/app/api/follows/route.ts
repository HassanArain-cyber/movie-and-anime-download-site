import { pool } from "@/db";
import { ApiError, positiveId, readJson } from "@/lib/validation";
import { notificationError, subscriber, notificationRateLimit, privateJson } from "@/lib/notifications/session";
import { isWatchStatus } from "@/lib/watch-status";
async function change(req: Request, action: "follow" | "unfollow" | "status") {
  try {
    const session = await subscriber(req);
    await notificationRateLimit(req, `write:${session.id}`);
    const body = await readJson(req, 1024);
    const id = positiveId(body.mediaId, "mediaId");
    const status = body.watchStatus;
    if (action === "status" && !isWatchStatus(status)) throw new ApiError(400, "Choose a valid watch status");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize a browser's writes: the 500-title limit cannot be raced.
      await client.query("SELECT id FROM subscribers WHERE id=$1 FOR UPDATE", [session.id]);
      const found = await client.query("SELECT type FROM media WHERE id=$1", [id]);
      if (!found.rowCount) throw new ApiError(404, "Title not found");
      if (action !== "unfollow" && !["anime", "series"].includes(found.rows[0].type)) throw new ApiError(400, "Only anime and series can be followed");
      if (action === "unfollow") {
        await client.query("DELETE FROM anime_follows WHERE subscriber_id=$1 AND media_id=$2", [session.id, id]);
      } else if (action === "status") {
        const updated = await client.query("UPDATE anime_follows SET watch_status=$3 WHERE subscriber_id=$1 AND media_id=$2 RETURNING media_id", [session.id, id, status]);
        if (!updated.rowCount) throw new ApiError(404, "Follow this title before changing its status");
      } else {
        const count = await client.query("SELECT count(*)::int AS count FROM anime_follows WHERE subscriber_id=$1", [session.id]);
        const exists = await client.query("SELECT 1 FROM anime_follows WHERE subscriber_id=$1 AND media_id=$2", [session.id, id]);
        if (!exists.rowCount && count.rows[0].count >= 500) throw new ApiError(409, "This browser can follow up to 500 titles. Unfollow a title first.");
        await client.query("INSERT INTO anime_follows (subscriber_id,media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [session.id, id]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const count = await pool.query("SELECT count(*)::int AS count FROM anime_follows WHERE media_id=$1", [id]);
    return privateJson({ following: action !== "unfollow", followerCount: count.rows[0].count });
  } catch (error) { return notificationError(error); }
}
export async function POST(req: Request) { return change(req, "follow"); }
export async function DELETE(req: Request) { return change(req, "unfollow"); }

export async function PATCH(req: Request) { return change(req, "status"); }
