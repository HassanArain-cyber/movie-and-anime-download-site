import "server-only";
import { pool } from "@/db";
import { ApiError } from "../validation";

export const notificationsSetupMessage = "Following and notifications are not set up yet. Please try again later.";

/** A deployment can precede the explicitly authorized 0007 installation.
 * Probe before subscriber/rate-limit writes; never install or repair schema here.
 * This is capability detection, not proof of a matching migration ledger/ACLs.
 * Do not cache failure: Retry must recover as soon as setup is actually ready.
 */
export async function requireNotificationsReady() {
  const result = await pool.query(`SELECT
    to_regclass('public.subscribers') IS NOT NULL
    AND to_regclass('public.anime_follows') IS NOT NULL
    AND to_regclass('public.episode_publications') IS NOT NULL
    AND to_regclass('public.episode_notifications') IS NOT NULL
    AND to_regclass('public.auth_rate_limits') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid=to_regclass('public.anime_follows')
        AND attname='watch_status' AND attnum>0 AND NOT attisdropped)
    AS ready`);
  if (result.rows[0]?.ready !== true) {
    console.error("Notification schema unavailable", "NOTIFICATION_SCHEMA_NOT_READY");
    throw new ApiError(503, notificationsSetupMessage);
  }
}
