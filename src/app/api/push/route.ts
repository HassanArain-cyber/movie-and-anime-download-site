import { pool } from "@/db";
import { ApiError, readJson } from "@/lib/validation";
import { endpointHash, normalizePushSubscription } from "@/lib/notifications/push-validation";
import { vapidConfig } from "@/lib/notifications/push-config";
import { notificationError, notificationRateLimit, privateJson, subscriber } from "@/lib/notifications/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pushSchemaReady() {
  const result = await pool.query("SELECT to_regclass('push_subscriptions') IS NOT NULL AND to_regclass('push_deliveries') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}
async function requirePushConfigured() {
  const config = vapidConfig();
  if (!config || !(await pushSchemaReady())) throw new ApiError(503, "Background alerts are not configured yet.");
  return config;
}

export async function GET() {
  try {
    const config = vapidConfig();
    if (!config) return privateJson({ configured: false });
    return privateJson({ configured: await pushSchemaReady(), publicKey: config.publicKey });
  } catch {
    return privateJson({ configured: false });
  }
}

/** A subscription is owned by the existing anonymous HttpOnly subscriber cookie. */
export async function POST(req: Request) {
  try {
    await requirePushConfigured();
    const account = await subscriber(req);
    await notificationRateLimit(req, "push:write:" + account.id, 25, 3600);
    const body = await readJson(req, 8192);
    const parsed = normalizePushSubscription(body);
    if (!parsed) throw new ApiError(400, "Unsupported or invalid browser push subscription.");
    const hash = endpointHash(parsed.endpoint);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM subscribers WHERE id=$1 FOR UPDATE", [account.id]);
      const count = await client.query("SELECT count(*)::integer AS total FROM push_subscriptions WHERE subscriber_id=$1", [account.id]);
      const existing = await client.query("SELECT id FROM push_subscriptions WHERE subscriber_id=$1 AND endpoint_hash=$2", [account.id, hash]);
      if (!existing.rowCount && count.rows[0].total >= 5) throw new ApiError(409, "Up to five devices can receive background alerts.");
      const result = await client.query([
        "INSERT INTO push_subscriptions (subscriber_id, endpoint_hash, endpoint, p256dh, auth)",
        "VALUES ($1,$2,$3,$4,$5) ON CONFLICT (endpoint_hash) DO UPDATE",
        "SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, updated_at=now()",
        "WHERE push_subscriptions.subscriber_id=EXCLUDED.subscriber_id RETURNING id",
      ].join(" "), [account.id, hash, parsed.endpoint, parsed.keys.p256dh, parsed.keys.auth]);
      if (!result.rowCount) throw new ApiError(409, "Subscription is already registered to another browser.");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return privateJson({ subscribed: true });
  } catch (error) { return notificationError(error); }
}

export async function DELETE(req: Request) {
  try {
    await requirePushConfigured();
    const account = await subscriber(req);
    await notificationRateLimit(req, "push:write:" + account.id, 25, 3600);
    const body = await readJson(req, 4096);
    if (typeof body.endpoint !== "string" || !body.endpoint || body.endpoint.length > 3072)
      throw new ApiError(400, "Invalid subscription.");
    await pool.query("DELETE FROM push_subscriptions WHERE subscriber_id=$1 AND endpoint_hash=$2", [account.id, endpointHash(body.endpoint)]);
    return privateJson({ subscribed: false });
  } catch (error) { return notificationError(error); }
}
