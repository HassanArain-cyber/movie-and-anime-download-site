import "server-only";
import { pool } from "@/db";
export async function notificationHistory(subscriberId: string, before: number | null = null, limit = 30) {
  const result = await pool.query(`SELECT n.id,n.read_at AS "readAt",n.created_at AS "createdAt",p.media_id AS "mediaId",p.title,p.episode_number AS "episodeNumber",p.episode_title AS "episodeTitle",p.season_number AS "seasonNumber",p.url
    FROM episode_notifications n JOIN episode_publications p ON p.episode_id=n.episode_id WHERE n.subscriber_id=$1 AND ($2::integer IS NULL OR n.id<$2) ORDER BY n.id DESC LIMIT $3`, [subscriberId, before, limit + 1]);
  return { notifications: result.rows.slice(0, limit), hasMore: result.rows.length > limit };
}
