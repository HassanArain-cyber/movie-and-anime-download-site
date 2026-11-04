import { pool } from "@/db";
import { ApiError, positiveId, readJson } from "@/lib/validation";
import { notificationError, subscriber, notificationRateLimit, privateJson } from "@/lib/notifications/session";
import { notificationHistory } from "@/lib/notifications/inbox";
export async function GET(req: Request) {
  try {
    const session = await subscriber(req);
    await notificationRateLimit(req, `read:${session.id}`, 240);
    const raw = new URL(req.url).searchParams.get("before");
    return privateJson(await notificationHistory(session.id, raw ? positiveId(raw, "before") : null));
  } catch (error) { return notificationError(error); }
}
export async function PATCH(req: Request) {
  try {
    const session = await subscriber(req);
    await notificationRateLimit(req, `write:${session.id}`);
    const body = await readJson(req, 1024);
    if (body.all === true) await pool.query("UPDATE episode_notifications SET read_at=now() WHERE subscriber_id=$1 AND read_at IS NULL", [session.id]);
    else {
      if ("all" in body) throw new ApiError(400, "all must be true");
      const id = positiveId(body.id);
      const updated = await pool.query("UPDATE episode_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND subscriber_id=$2 RETURNING id", [id, session.id]);
      if (!updated.rowCount) throw new ApiError(404, "Notification not found");
    }
    return privateJson({ success: true });
  } catch (error) { return notificationError(error); }
}
