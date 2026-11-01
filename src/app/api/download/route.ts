import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { downloadLinks, r2Uploads } from "@/db/schema";
import { signedObjectUrl } from "@/lib/storage";
import { isLegacyUpload, isR2Url, safeExternalUrl } from "@/lib/media-links";
import { ApiError, errorResponse, positiveId } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/x-m4v", ".webm": "video/webm",
  ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".zip": "application/zip", ".rar": "application/vnd.rar", ".7z": "application/x-7z-compressed",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

function redirect(url: string) {
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

async function legacyResponse(req: Request, url: string, alreadyDecoded = false) {
  const root = await realpath(path.join(process.cwd(), "public", "uploads")).catch(() => null);
  if (!root) throw new ApiError(404, "Legacy upload directory is not available on this deployment");
  let decoded: string;
  if (alreadyDecoded) decoded = url;
  else { try { decoded = decodeURIComponent(url); } catch { throw new ApiError(400, "Invalid file path"); } }
  if (decoded.includes("\0") || decoded.includes("\\")) throw new ApiError(400, "Invalid file path");
  const candidate = path.resolve(process.cwd(), "public", `.${decoded}`);
  const filePath = await realpath(candidate).catch(() => null);
  if (!filePath || (filePath !== root && !filePath.startsWith(root + path.sep))) throw new ApiError(404, "File not available");
  const info = await stat(filePath);
  if (!info.isFile()) throw new ApiError(404, "File not available");
  const fileName = path.basename(filePath);
  const headers = new Headers({
    "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (suffix <= 0) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
      start = Math.max(0, info.size - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  if (req.method === "HEAD") return new Response(null, { status, headers });
  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers });
}

async function handle(req: Request) {
  const params = new URL(req.url).searchParams;
  const idParam = params.get("id");
  let url = params.get("url");
  if (idParam !== null && url !== null) throw new ApiError(400, "Provide either id or url, not both");
  if (idParam !== null) {
    const id = positiveId(idParam, "id");
    const [link] = await db.select().from(downloadLinks).where(eq(downloadLinks.id, id)).limit(1);
    if (!link) throw new ApiError(404, "Download link not found");
    if (isR2Url(link.url) || link.storageProvider === "r2") {
      const key = link.objectKey || (isR2Url(link.url) ? link.url.slice("r2:///".length) : null);
      if (!key) throw new ApiError(404, "R2 object metadata is missing");
      const [object] = await db.select().from(r2Uploads).where(eq(r2Uploads.objectKey, key)).limit(1);
      if (!object || object.status !== "completed" || object.kind === "image") throw new ApiError(404, "R2 object is not available");
      return redirect(await signedObjectUrl(object, req.method === "HEAD" ? "HEAD" : "GET"));
    }
    url = link.url;
  }
  if (!url) throw new ApiError(400, "Missing url or id");
  // Direct URL access is only allowed for a URL already recorded in the DB.
  // This prevents the endpoint from becoming an open redirect for arbitrary URLs.
  const [known] = await db.select({ id: downloadLinks.id }).from(downloadLinks).where(eq(downloadLinks.url, url)).limit(1);
  if (!known) throw new ApiError(404, "File not available");
  if (isLegacyUpload(url)) return legacyResponse(req, url, true);
  const external = safeExternalUrl(url);
  if (!external) throw new ApiError(400, "Unsupported download URL");
  return redirect(external);
}

export async function GET(req: Request) {
  try { return await handle(req); } catch (error) { return errorResponse(error); }
}
export async function HEAD(req: Request) {
  try { return await handle(req); } catch (error) { return errorResponse(error); }
}
