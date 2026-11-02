import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "./validation";
import { clientRateLimitKey, rateLimitSettings } from "./request-security";

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

function bucketKey(scope: string, purpose: "auth" | "contact" = "auth"): string {
  const secret = purpose === "contact"
    ? process.env.CONTACT_RATE_LIMIT_SECRET || process.env.ADMIN_PASSWORD
    : process.env.ADMIN_PASSWORD;
  if (!secret) throw new ApiError(503, "Request rate limiting is not configured");
  // Domain-separated from session keys and other counters. Raw IPs are never stored.
  return crypto.createHmac("sha256", `${purpose}-rate-limit:${secret}`).update(scope).digest("hex");
}

async function consume(scope: string, limit: number, windowSeconds: number, purpose: "auth" | "contact" = "auth"): Promise<RateLimitDecision> {
  const key = bucketKey(scope, purpose);
  // One atomic UPSERT is the concurrency boundary: parallel requests across
  // processes/instances cannot each read-then-write a stale counter. Database
  // clock_timestamp() keeps the window consistent across app instances.
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (key, attempts, expires_at)
    VALUES (${key}, 1, clock_timestamp() + (${windowSeconds} * interval '1 second'))
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.expires_at <= clock_timestamp() THEN 1 ELSE LEAST(auth_rate_limits.attempts + 1, ${limit + 1}) END,
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

/** Public contact submissions use separate, shared PostgreSQL counters. */
export async function consumeContactAttempt(req: Request): Promise<RateLimitDecision> {
  const windowSeconds = boundedSetting("CONTACT_RATE_LIMIT_WINDOW_SECONDS", 900, 1, 86400);
  const clientLimit = boundedSetting("CONTACT_RATE_LIMIT_MAX_ATTEMPTS", 5, 1, 100);
  const globalLimit = boundedSetting("CONTACT_RATE_LIMIT_GLOBAL_MAX_ATTEMPTS", 100, 1, 10000);
  const client = clientRateLimitKey(req);
  try {
    if (client.trusted) {
      const perClient = await consume(`contact:${client.key}`, clientLimit, windowSeconds, "contact");
      if (!perClient.allowed) return perClient;
    }
    return await consume("contact:global", globalLimit, windowSeconds, "contact");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Contact rate limiter unavailable:", (error as { code?: string })?.code ?? "unknown");
    throw new ApiError(503, "Request submission is temporarily unavailable. Please try again later.");
  }
}

function boundedSetting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(503, `${name} is outside its supported range`);
  }
  return value;
}
