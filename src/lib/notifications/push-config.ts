import "server-only";
import { isValidVapidPublicKey, isValidVapidPrivateKey } from "./push-validation";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** No server-side keys or contact identity are shipped to browsers. */
export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.PUSH_VAPID_SUBJECT;
  if (!isValidVapidPublicKey(publicKey) || !isValidVapidPrivateKey(privateKey) ||
      !subject || subject.length > 255 ||
      !(subject.startsWith("mailto:") || subject.startsWith("https://"))) return null;
  return { publicKey, privateKey, subject };
}
