import { createHash } from "node:crypto";

export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.opera.com",
]);

/** Never forward arbitrary caller-controlled URLs to the push sender (SSRF). */
export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 3072 || !value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const allowed = PUSH_HOSTS.has(host) ||
      host.endsWith(".notify.windows.com") ||
      host.endsWith(".push.apple.com");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
      (!parsed.port || parsed.port === "443") && !parsed.hash && allowed;
  } catch { return false; }
}

function base64urlBytes(value: unknown, length: number, uncompressed = false): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.length === length && (!uncompressed || bytes[0] === 4);
  } catch { return false; }
}

export function normalizePushSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isAllowedPushEndpoint(entry.endpoint) || !entry.keys ||
      !base64urlBytes(entry.keys.p256dh, 65, true) ||
      !base64urlBytes(entry.keys.auth, 16)) return null;
  return { endpoint: entry.endpoint, keys: {
    p256dh: entry.keys.p256dh as string,
    auth: entry.keys.auth as string,
  } };
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function safePushRoute(type: unknown, slug: unknown, episodeId: unknown): string {
  if (type !== "anime" && type !== "series") return "/notifications";
  if (typeof slug !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(slug)) return "/notifications";
  if (!Number.isSafeInteger(episodeId) || (episodeId as number) < 1) return "/notifications";
  return "/" + type + "/" + slug + "#episode-" + episodeId;
}

export function isValidVapidPublicKey(key: unknown): key is string {
  return base64urlBytes(key, 65, true);
}
export function isValidVapidPrivateKey(key: unknown): key is string {
  return base64urlBytes(key, 32);
}
