import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "admin_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.ADMIN_PASSWORD || "admin123";
  // Use a stable server-side secret derived from the password
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, getSecret(), 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(value)
    .digest("hex");
}

export async function login(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD || "admin123";
  if (password !== expected) return false;

  const expires = Date.now() + MAX_AGE * 1000;
  const payload = `admin.${expires}`;
  const signature = sign(payload);
  const cookieVal = `${payload}.${signature}`;

  (await cookies()).set(COOKIE_NAME, cookieVal, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, expiresStr, signature] = parts;
  if (role !== "admin") return false;

  const expires = Number(expiresStr);
  if (!expires || Date.now() > expires) return false;

  const expected = sign(`admin.${expiresStr}`);
  const valid = timingSafeEqual(signature, expected);
  return valid;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Helper to verify admin in server actions / route handlers
export async function requireAdmin(): Promise<true | Response> {
  if (!(await isAdmin())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return true;
}
