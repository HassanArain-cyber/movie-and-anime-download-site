import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { clientRateLimitKey } from "./request-security";
import { ApiError } from "./validation";

function setting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(503, `${name} is outside its supported range`);
  return value;
}

async function consume(scope: string, limit: number, windowSeconds: number, secret: string): Promise<boolean> {
  const key = crypto.createHmac("sha256", `comment-rate-limit:${secret}`).update(scope).digest("hex");
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (key, attempts, expires_at)
    VALUES (${key}, 1, clock_timestamp() + (${windowSeconds} * interval '1 second'))
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.expires_at <= clock_timestamp() THEN 1 ELSE LEAST(auth_rate_limits.attempts + 1, ${limit + 1}) END,
      expires_at = CASE WHEN auth_rate_limits.expires_at <= clock_timestamp()
        THEN clock_timestamp() + (${windowSeconds} * interval '1 second') ELSE auth_rate_limits.expires_at END
    RETURNING attempts, ceil(extract(epoch FROM (expires_at - clock_timestamp())))::int AS retry_after
  `);
  const row = result.rows[0] as { attempts: number; retry_after: number } | undefined;
  if (!row) throw new Error("Comment rate limit counter missing");
  if (row.attempts > limit) throw new ApiError(429, `Please wait ${Math.max(1, row.retry_after)} seconds before trying again.`);
  return true;
}

/** Shared PostgreSQL quotas are keyed only by HMACs, never raw IP/session values. */
export async function enforceCommentRateLimit(req: Request, sessionHash: string): Promise<void> {
  const secret = process.env.COMMENT_RATE_LIMIT_SECRET || process.env.CONTACT_RATE_LIMIT_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret || secret.length < 8) throw new ApiError(503, "Comment rate limiting is not configured");
  const windowSeconds = setting("COMMENT_RATE_LIMIT_WINDOW_SECONDS", 600, 1, 86400);
  const sessionLimit = setting("COMMENT_RATE_LIMIT_MAX_ATTEMPTS", 10, 1, 1000);
  const clientLimit = setting("COMMENT_RATE_LIMIT_CLIENT_MAX_ATTEMPTS", 40, 1, 5000);
  try {
    await consume(`session:${sessionHash}`, sessionLimit, windowSeconds, secret);
    const client = clientRateLimitKey(req);
    if (client.trusted) await consume(`client:${client.key}`, clientLimit, windowSeconds, secret);
    await db.execute(sql`DELETE FROM auth_rate_limits WHERE expires_at < clock_timestamp() - interval '1 day'`);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: string })?.code;
    console.error("Comment rate limiter unavailable:", code ?? "unknown");
    throw new ApiError(503, "Commenting is temporarily unavailable. Please try again later.");
  }
}
