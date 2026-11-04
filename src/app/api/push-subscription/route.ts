import { createHash } from "node:crypto";
import { pool } from "@/db";
import { ApiError, readJson } from "@/lib/validation";
import { notificationError, subscriber, notificationRateLimit, privateJson } from "@/lib/notifications/session";
import { validateSubscription } from "@/lib/notifications/validation";
import { decryptSubscription, encryptSubscription, pushConfigured } from "@/lib/notifications/subscription-crypto";
export async function POST(req: Request) {
  try {
    const session = await subscriber(req);
    await notificationRateLimit(req, `push:${session.id}`, 20);
    if (!pushConfigured()) throw new ApiError(503, "Browser push is not configured yet. In-site notifications still work.");
    const subscription = validateSubscription(await readJson(req, 8192));
    const hash = createHash("sha256").update(subscription.endpoint).digest("hex");
    const encrypted = encryptSubscription(subscription);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM subscribers WHERE id=$1 FOR UPDATE", [session.id]);
      const current = await client.query("SELECT id,endpoint_hash,encrypted FROM push_subscriptions WHERE subscriber_id=$1", [session.id]);
      const previous = current.rows[0];
      let unchanged = false;
      if (previous?.endpoint_hash === hash) {
        try { unchanged = JSON.stringify(decryptSubscription(previous.encrypted)) === JSON.stringify(subscription); }
        catch { /* A key rotation/repair replaces this version, never its history. */ }
      }
      if (unchanged) {
        // Do not reset created_at or delivery history on harmless resubmission.
        await client.query("UPDATE push_subscriptions SET encrypted=$1 WHERE subscriber_id=$2", [encrypted, session.id]);
      } else {
        await client.query("DELETE FROM push_subscriptions WHERE subscriber_id=$1", [session.id]);
        await client.query("INSERT INTO push_subscriptions (subscriber_id,endpoint_hash,encrypted) VALUES ($1,$2,$3)", [session.id, hash, encrypted]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw new ApiError(409, "This browser subscription belongs to another local identity. Disable it in browser site settings, then try again.");
      throw error;
    } finally { client.release(); }
    return privateJson({ enabled: true });
  } catch (error) { return notificationError(error); }
}
export async function DELETE(req: Request) {
  try {
    const session = await subscriber(req);
    await notificationRateLimit(req, `push:${session.id}`, 20);
    await pool.query("DELETE FROM push_subscriptions WHERE subscriber_id=$1", [session.id]);
    return privateJson({ enabled: false });
  } catch (error) { return notificationError(error); }
}
