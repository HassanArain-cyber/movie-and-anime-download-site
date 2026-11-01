import { isIP } from "node:net";
import { ApiError } from "./validation";

/**
 * Reject browser cross-site mutations. Non-browser clients (curl, server jobs)
 * may omit Origin/Sec-Fetch-Site; cookie authentication still applies to them.
 * Host is the authority the browser actually targeted, so it remains correct
 * behind a TLS-terminating proxy that preserves Host.
 */
export function assertSameOrigin(req: Request): void {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "Cross-site requests are not allowed");
  }
  const origin = req.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new ApiError(403, "Invalid request origin"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ApiError(403, "Invalid request origin");
  }
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    let expected: URL;
    try { expected = new URL(configured); } catch { throw new ApiError(503, "APP_ORIGIN is invalid"); }
    if (!["http:", "https:"].includes(expected.protocol) || expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash) {
      throw new ApiError(503, "APP_ORIGIN must be an http(s) origin without credentials, path, query, or fragment");
    }
    if (parsed.origin !== expected.origin) throw new ApiError(403, "Cross-site requests are not allowed");
    return;
  }
  const host = (req.headers.get("host") || new URL(req.url).host).toLowerCase();
  if (!host || parsed.host.toLowerCase() !== host) {
    throw new ApiError(403, "Cross-site requests are not allowed");
  }
}

export type ClientIpResult = { key: string; trusted: boolean };

/**
 * Forwarded headers are ignored unless the operator explicitly names one
 * header that their trusted proxy overwrites. The value must be a single IP;
 * lists and malformed values fall back to the shared global bucket.
 */
export function clientRateLimitKey(req: Request): ClientIpResult {
  const header = process.env.ADMIN_LOGIN_TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (!header || !/^[a-z0-9-]+$/.test(header)) return { key: "global", trusted: false };
  const raw = req.headers.get(header)?.trim();
  if (!raw || raw.includes(",") || !isIP(raw)) return { key: "global", trusted: false };
  // Normalize IPv6 text so equivalent representations share one bucket.
  let normalized = raw;
  if (isIP(raw) === 6) {
    normalized = new URL(`http://[${raw}]`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (dotted && isIP(dotted[1]) === 4) normalized = dotted[1];
    else if (hex) normalized = `${parseInt(hex[1], 16) >> 8}.${parseInt(hex[1], 16) & 255}.${parseInt(hex[2], 16) >> 8}.${parseInt(hex[2], 16) & 255}`;
  }
  return { key: `ip:${normalized}`, trusted: true };
}

export function rateLimitSettings() {
  const windowSeconds = bounded("ADMIN_LOGIN_WINDOW_SECONDS", 900, 1, 86400);
  return {
    windowSeconds,
    clientLimit: bounded("ADMIN_LOGIN_MAX_ATTEMPTS", 5, 1, 100),
    globalLimit: bounded("ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS", 30, 1, 1000),
  };
}

function bounded(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(503, `${name} is outside its supported range`);
  }
  return value;
}
