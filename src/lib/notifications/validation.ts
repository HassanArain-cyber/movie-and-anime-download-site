import { ECDH } from "node:crypto";
import { ApiError } from "../validation";

export type StoredSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
/** Exact browser push-service hosts only; never let a public endpoint become an SSRF proxy. */
export function validateSubscription(value: unknown): StoredSubscription {
  if (!value || typeof value !== "object") throw new ApiError(400, "Invalid push subscription");
  const input = value as Record<string, unknown>;
  if (typeof input.endpoint !== "string" || input.endpoint.length > 4096) throw new ApiError(400, "Invalid push endpoint");
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new ApiError(400, "Invalid push endpoint"); }
  const h = url.hostname;
  const allowed = h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h === "web.push.apple.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(h);
  if (url.href.length > 4096 || !allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.pathname === "/") throw new ApiError(400, "Unsupported browser push service");
  const keys = input.keys as Record<string, unknown> | undefined;
  const p256dh = keys?.p256dh, auth = keys?.auth;
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) || typeof auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(auth)) throw new ApiError(400, "Invalid push encryption keys");
  const point = Buffer.from(p256dh, "base64url"), authBytes = Buffer.from(auth, "base64url");
  if (point.length !== 65 || point[0] !== 4 || point.toString("base64url") !== p256dh || authBytes.toString("base64url") !== auth) throw new ApiError(400, "Invalid push encryption keys");
  try { ECDH.convertKey(point, "prime256v1"); } catch { throw new ApiError(400, "Invalid push encryption key"); }
  return { endpoint: url.href, keys: { p256dh, auth } };
}
export function retryDelay(attempt: number): number { return Math.min(3600, 30 * 2 ** Math.min(7, Math.max(0, attempt - 1))); }
export function pushFailure(status: number | undefined, attempts: number): "expired" | "failed" | "pending" {
  if (status === 404 || status === 410) return "expired";
  if (attempts >= 8 || (status !== undefined && status >= 400 && status < 500 && ![408, 429].includes(status))) return "failed";
  return "pending";
}
