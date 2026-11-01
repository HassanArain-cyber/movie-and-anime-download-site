import { NextResponse } from "next/server";
import { safeExternalUrl } from "./media-links";
import type { MediaType, VideoQuality } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 1024 * 1024) throw new ApiError(413, "Request is too large");
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new ApiError(400, "Invalid JSON body"); }
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
  if (value !== "720p" && value !== "1080p" && value !== "other") {
    throw new ApiError(400, "Quality must be 720p, 1080p, or other");
  }
  return value;
}

export function mediaType(value: unknown): MediaType {
  if (value !== "movie" && value !== "anime" && value !== "series") {
    throw new ApiError(400, "Type must be movie, anime, or series");
  }
  return value;
}

export function year(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1800 || result > 2200) throw new ApiError(400, "Year must be between 1800 and 2200");
  return result;
}

export function externalUrl(value: unknown): string {
  const result = text(value, "URL", 8192, true)!;
  if (!safeExternalUrl(result)) throw new ApiError(400, "Use an HTTPS, HTTP, Telegram, or magnet link. Upload files to R2 instead of entering a local path.");
  return result;
}

export function uuid(value: unknown, name = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `${name} must be a valid upload ID`);
  }
  return value;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") return NextResponse.json({ error: "That record already exists" }, { status: 409 });
  if (code === "23503") return NextResponse.json({ error: "The related media, season, or episode no longer exists" }, { status: 409 });
  console.error(error);
  return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });
}
