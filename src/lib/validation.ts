import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { normalizeQuality, safeExternalUrl } from "./media-links";
import type { MediaType, VideoQuality } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const JSON_TYPE = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i;

/** Stream JSON with a hard byte ceiling; never buffer an unbounded request body. */
export async function readJson(req: Request, maxBytes = 1024 * 1024): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") || "";
  if (!JSON_TYPE.test(type)) throw new ApiError(415, "Content-Type must be application/json");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, "Request is too large");
  if (!req.body) throw new ApiError(400, "Invalid JSON body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "Request is too large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "Invalid JSON body"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Expected a JSON object");
  return body as Record<string, unknown>;
}

export function positiveId(value: unknown, name = "id"): number {
  const number = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) {
    throw new ApiError(400, `${name} must be a positive integer`);
  }
  return number;
}

export function optionalId(value: unknown, name: string): number | null {
  return value === undefined || value === null || value === "" ? null : positiveId(value, name);
}

export function text(value: unknown, name: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(400, `${name} is required`);
    return null;
  }
  if (typeof value !== "string") throw new ApiError(400, `${name} must be text`);
  const result = value.trim();
  if (result.length > max) throw new ApiError(400, `${name} must be at most ${max} characters`);
  if (required && !result) throw new ApiError(400, `${name} is required`);
  return result || null;
}

export function quality(value: unknown): VideoQuality | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = normalizeQuality(value);
  if (!normalized) throw new ApiError(400, "Choose a supported video quality (360p, 480p, 720p, 1080p, 2K, 4K, 8K, or Other)");
  return normalized;
}

export function mediaType(value: unknown): MediaType {
  if (value !== "movie" && value !== "anime" && value !== "series") {
    throw new ApiError(400, "Type must be movie, anime, or series");
  }
  return value;
}

export function year(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1800 || number > 2200) throw new ApiError(400, "Year must be between 1800 and 2200");
  return number;
}

export function externalUrl(value: unknown): string {
  const result = text(value, "URL", 8192, true)!;
  if (!safeExternalUrl(result)) throw new ApiError(400, "Use an HTTPS, HTTP, Telegram, or magnet link. Upload files to R2 instead of entering a local path.");
  return result;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) {
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab][0-9a-f]:/i.test(host) || host.startsWith("::ffff:");
  }
  return false;
}

/** Poster/thumbnail URLs must be safe to render and must not point the image optimizer at private networks. */
export function imageUrl(value: unknown, name = "Image URL"): string | null {
  const result = text(value, name, 8192);
  if (!result) return null;
  if (result.startsWith("/uploads/")) {
    // Reject traversal at every decoding layer so %252e%252e cannot slip past
    // a single decode and later be normalized by a static file server.
    let decoded = result;
    for (let i = 0; i < 8; i++) {
      if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some((part) => part === "..")) {
        throw new ApiError(400, `${name} has an invalid legacy path`);
      }
      let next: string;
      try { next = decodeURIComponent(decoded); } catch { throw new ApiError(400, `${name} has an invalid legacy path`); }
      if (next === decoded) return result;
      decoded = next;
    }
    throw new ApiError(400, `${name} has an invalid legacy path`);
  }
  if (result.startsWith("/api/image?")) {
    const params = new URL(result, "http://local").searchParams;
    const upload = params.get("upload");
    if (params.size === 1 && upload && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(upload)) return result;
    throw new ApiError(400, `${name} must reference a valid image upload`);
  }
  let url: URL;
  try { url = new URL(result); } catch { throw new ApiError(400, `${name} must be an HTTP(S), legacy upload, or R2 image URL`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new ApiError(400, `${name} must be a public HTTP(S) image URL`);
  }
  return result;
}

export function uuid(value: unknown, name = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `${name} must be a valid upload ID`);
  }
  return value;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") return NextResponse.json({ error: "That record already exists" }, { status: 409, headers: NO_STORE });
  if (code === "23503") return NextResponse.json({ error: "The related media, season, or episode no longer exists" }, { status: 409, headers: NO_STORE });
  console.error(error);
  return NextResponse.json({ error: "Server error. Please try again." }, { status: 500, headers: NO_STORE });
}
