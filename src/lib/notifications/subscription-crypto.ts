import { createCipheriv, createDecipheriv, createECDH, randomBytes } from "node:crypto";
import { ApiError } from "../validation";
import { validateSubscription, type StoredSubscription } from "./validation";
function key(): Buffer {
  const raw = process.env.PUSH_SUBSCRIPTION_SECRET || "";
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== raw) throw new ApiError(503, "Push subscription encryption is not configured");
  return bytes;
}
export function encryptSubscription(subscription: StoredSubscription): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("vault-push-subscription-v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(subscription), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptSubscription(envelope: string): StoredSubscription {
  const [version, iv, tag, payload, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !payload || extra) throw new Error("Invalid subscription envelope");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from("vault-push-subscription-v1"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return validateSubscription(JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8")));
}
export function pushConfigured(): boolean {
  try {
    key();
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "", privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
    const subject = process.env.WEB_PUSH_SUBJECT || "";
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) return false;
    const pair = createECDH("prime256v1"); pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
    return pair.getPublicKey().toString("base64url") === publicKey;
  } catch { return false; }
}
