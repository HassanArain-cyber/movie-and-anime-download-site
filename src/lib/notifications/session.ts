import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { pool } from "@/db";
import { assertSameOrigin, clientRateLimitKey } from "../request-security";
import { ApiError, errorResponse } from "../validation";
import { requireNotificationsReady, notificationsSetupMessage } from "./readiness";
const COOKIE = "vault_subscriber";
export const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function privateJson(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: privateHeaders }); }
export async function notificationRateLimit(req: Request, scope: string, limit = 120, seconds = 600) {
  const secret = process.env.NOTIFICATION_RATE_LIMIT_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret || secret.length < 8) throw new ApiError(503, "Notification rate limiting is not configured");
  const key = createHmac("sha256", secret).update(`notification:${scope}`).digest("hex");
  const result = await pool.query(`INSERT INTO auth_rate_limits (key, attempts, expires_at) VALUES ($1,1,clock_timestamp()+($3*interval '1 second'))
    ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.expires_at<=clock_timestamp() THEN 1 ELSE LEAST(auth_rate_limits.attempts+1,$2+1) END,
    expires_at=CASE WHEN auth_rate_limits.expires_at<=clock_timestamp() THEN clock_timestamp()+($3*interval '1 second') ELSE auth_rate_limits.expires_at END RETURNING attempts`, [key, limit, seconds]);
  if (result.rows[0].attempts > limit) throw new ApiError(429, "Too many requests. Please try again later.");
  // Trusted deployment IPs only; never persist raw client addresses.
  void req;
}
export async function subscriber(req: Request, create = false): Promise<{ id: string; token?: string }> {
  assertSameOrigin(req);
  await requireNotificationsReady();
  const token = (req.headers.get("cookie") || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const id = createHash("sha256").update(`vault-subscriber:${token}`).digest("hex");
    const existing = await pool.query("SELECT id FROM subscribers WHERE id=$1", [id]);
    if (existing.rowCount) return { id };
  }
  if (!create) throw new ApiError(401, "Initialize this browser's notification preferences first");
  const client = clientRateLimitKey(req);
  if (client.trusted) await notificationRateLimit(req, `create:${client.key}`, 30, 3600);
  await notificationRateLimit(req, "create:global", 2000, 3600);
  const next = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(`vault-subscriber:${next}`).digest("hex");
  await pool.query("INSERT INTO subscribers (id) VALUES ($1)", [id]);
  return { id, token: next };
}
export function setSubscriberCookie(response: NextResponse, token?: string) {
  if (token) response.cookies.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
}

export function notificationError(error: unknown) {
  const pgError = error as { code?: string; cause?: { code?: string } } | null;
  const code = pgError?.code ?? pgError?.cause?.code;
  let response: NextResponse;
  if (error instanceof ApiError || code === "23505" || code === "23503") response = errorResponse(error);
  else {
    // PostgreSQL/provider errors can contain row details or private capability
    // URLs. This feature logs only a database error code, never the object.
    console.error("Notification request unavailable", code && /^[A-Z0-9]{5}$/.test(code) ? code : "unavailable");
    response = privateJson({ error: code === "42P01" || code === "42703"
      ? notificationsSetupMessage
      : "Notifications are temporarily unavailable. Please try again." }, 503);
  }
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}
