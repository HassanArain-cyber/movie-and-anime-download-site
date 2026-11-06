import { after } from "next/server";
import { pool } from "@/db";
import { notificationError, privateJson, setSubscriberCookie, subscriber, notificationRateLimit } from "@/lib/notifications/session";
import { notificationHistory } from "@/lib/notifications/inbox";
import { safelyProcessNotifications } from "@/lib/notifications/worker";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const session = await subscriber(req, true);
    await notificationRateLimit(req, `read:${session.id}`, 240);
    const [following, unread, history] = await Promise.all([
      pool.query(`SELECT f.watch_status AS "watchStatus",m.id,m.title,m.type,m.slug,m.poster_url AS "posterUrl",EXISTS (SELECT 1 FROM episode_notifications n JOIN episode_publications p ON p.episode_id=n.episode_id WHERE n.subscriber_id=$1 AND n.read_at IS NULL AND p.media_id=m.id) AS "hasNew"
        FROM anime_follows f JOIN media m ON m.id=f.media_id WHERE f.subscriber_id=$1 ORDER BY f.created_at DESC,m.id LIMIT 500`, [session.id]),
      pool.query("SELECT count(*)::int AS count FROM episode_notifications WHERE subscriber_id=$1 AND read_at IS NULL", [session.id]),
      notificationHistory(session.id),
    ]);
    const response = privateJson({ following: following.rows, unread: unread.rows[0].count, ...history });
    setSubscriberCookie(response, session.token);
    after(safelyProcessNotifications);
    return response;
  } catch (error) { return notificationError(error); }
}
