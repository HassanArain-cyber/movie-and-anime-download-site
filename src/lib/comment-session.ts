import "server-only";
import crypto from "node:crypto";
import { ApiError } from "./validation";

export const COMMENT_SESSION_COOKIE = "vault_comment_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

type Session = { hash: string; cookieValue: string | null };

function secret(): Buffer {
  const value = process.env.COMMENT_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!value || value.length < 8) throw new ApiError(503, "Comment sessions are not configured");
  return crypto.createHash("sha256").update(`comment-session:${value}`).digest();
}

function signature(id: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(`session:${id}`).digest("hex");
}

function readCookie(req: Request): string | undefined {
  const raw = req.headers.get("cookie") || "";
  for (const item of raw.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === COMMENT_SESSION_COOKIE) return value.join("=");
  }
  return undefined;
}

export function getCommentSession(req: Request): Session {
  const key = secret();
  const token = readCookie(req);
  if (token) {
    const [id, sig, extra] = token.split(".");
    if (!extra && id && sig && /^[0-9a-f-]{36}$/i.test(id)) {
      const expected = signature(id, key);
      const actualBytes = Buffer.from(sig, "hex");
      const expectedBytes = Buffer.from(expected, "hex");
      if (actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes)) {
        return {
          hash: crypto.createHmac("sha256", key).update(`identity:${id}`).digest("hex"),
          cookieValue: null,
        };
      }
    }
  }

  const id = crypto.randomUUID();
  const value = `${id}.${signature(id, key)}`;
  return {
    hash: crypto.createHmac("sha256", key).update(`identity:${id}`).digest("hex"),
    cookieValue: value,
  };
}

export function setCommentSessionCookie(response: Response, session: Session): void {
  if (!session.cookieValue || !(response instanceof Response)) return;
  // NextResponse exposes a cookie helper; the fallback keeps this helper safe
  // if the response implementation changes while never returning the token in JSON.
  const nextResponse = response as Response & { cookies?: { set: (name: string, value: string, options: Record<string, unknown>) => void } };
  nextResponse.cookies?.set(COMMENT_SESSION_COOKIE, session.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}
