import { createHash, timingSafeEqual } from "node:crypto";
import { pool } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { ApiError, readJson } from "@/lib/validation";
import { notificationError, privateJson } from "@/lib/notifications/session";
import { processNotifications } from "@/lib/notifications/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) throw new ApiError(503, "Notification retry authorization is not configured");
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (!timingSafeEqual(digest(req.headers.get("authorization") || ""), digest(`Bearer ${secret}`))) throw new ApiError(401, "Unauthorized");
    return privateJson(await processNotifications());
  } catch (error) { return notificationError(error); }
}
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req, 1024);
    if ("retryFailed" in body && typeof body.retryFailed !== "boolean") throw new ApiError(400, "retryFailed must be true or false");
    let requeued = 0;
    if (body.retryFailed === true) {
      const result = await pool.query(`UPDATE push_deliveries SET state='pending',attempts=0,next_attempt=now(),lease_until=NULL,lease_token=NULL
        WHERE id IN (SELECT id FROM push_deliveries WHERE state='failed' ORDER BY id LIMIT 200) RETURNING id`);
      requeued = result.rowCount || 0;
    }
    return privateJson({ ...await processNotifications(), requeued });
  }
  catch (error) { return notificationError(error); }
}
