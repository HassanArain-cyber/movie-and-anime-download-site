import "server-only";
import { pool } from "@/db";
import { ApiError } from "../validation";

export const notificationsSetupMessage = "Following and notifications are not set up yet. Please try again later.";

/** A deployment can precede the explicitly authorized 0007 installation.
 * Probe before subscriber/rate-limit writes; never install or repair schema here.
 * This is capability detection, not proof of a matching migration ledger/ACLs.
 * Do not cache failure: Retry must recover as soon as setup is actually ready.
 *
 * Names are deliberately unqualified for the same reason the feature queries are:
 * resolution must follow the session search_path, so exactly the relations the
 * runtime touches are the ones being checked.
 */
export async function requireNotificationsReady() {
  const result = await pool.query(`SELECT
    to_regclass('subscribers') IS NOT NULL
    AND to_regclass('anime_follows') IS NOT NULL
    AND to_regclass('episode_publications') IS NOT NULL
    AND to_regclass('episode_notifications') IS NOT NULL
    AND to_regclass('auth_rate_limits') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid=to_regclass('anime_follows')
        AND attname='watch_status' AND attnum>0 AND NOT attisdropped)
    AS ready`);
  if (result.rows[0]?.ready !== true) {
    console.error("Notification schema unavailable", "NOTIFICATION_SCHEMA_NOT_READY");
    throw new ApiError(503, notificationsSetupMessage);
  }
}
