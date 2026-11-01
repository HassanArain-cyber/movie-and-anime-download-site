import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "./validation";
import { clientRateLimitKey, rateLimitSettings } from "./request-security";

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

function bucketKey(scope: string): string {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) throw new ApiError(503, "Admin login is not configured");
  // Domain-separated from the session-signing key. Raw IPs are never stored.
  return crypto.createHmac("sha256", `auth-rate-limit:${secret}`).update(scope).digest("hex");
}

async function consume(scope: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
  const key = bucketKey(scope);
  // One atomic UPSERT is the concurrency boundary: parallel requests across
  // processes/instances cannot each read-then-write a stale counter. Database
  // clock_timestamp() keeps the window consistent across app instances.
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (key, attempts, expires_at)
    VALUES (${key}, 1, clock_timestamp() + (${windowSeconds} * interval '1 second'))
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.expires_at <= clock_timestamp() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
      expires_at = CASE WHEN auth_rate_limits.expires_at <= clock_timestamp()
        THEN clock_timestamp() + (${windowSeconds} * interval '1 second')
        ELSE auth_rate_limits.expires_at END
    RETURNING attempts, ceil(extract(epoch FROM (expires_at - clock_timestamp())))::int AS retry_after
  `);
  const row = result.rows[0] as { attempts: number; retry_after: number } | undefined;
  if (!row) throw new Error("Rate limit counter was not returned");
  // Housekeeping is bounded and never removes an active window.
  await db.execute(sql`DELETE FROM auth_rate_limits WHERE expires_at < clock_timestamp() - interval '1 day'`);
  if (row.attempts > limit) return { allowed: false, retryAfter: Math.max(1, row.retry_after) };
  return { allowed: true };
}

/** Fixed-window limits shared by every app instance through PostgreSQL. */
export async function consumeLoginAttempt(req: Request): Promise<RateLimitDecision> {
  const settings = rateLimitSettings();
  const client = clientRateLimitKey(req);
  try {
    if (client.trusted) {
      const perClient = await consume(client.key, settings.clientLimit, settings.windowSeconds);
      if (!perClient.allowed) return perClient;
    }
    return await consume("global", settings.globalLimit, settings.windowSeconds);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Fail closed: a database outage must not turn into unlimited guessing.
    console.error("Login rate limiter unavailable:", (error as { code?: string })?.code ?? "unknown");
    throw new ApiError(503, "Login is temporarily unavailable. Please try again later.");
  }
}
