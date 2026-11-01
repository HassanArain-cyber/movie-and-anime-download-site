import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { resolveTarget } from "@/lib/library";
import { initializeUpload } from "@/lib/storage";
import { ApiError, errorResponse, readJson } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only metadata and short-lived part URLs pass through Next.js. File bytes go
// directly from the browser to private R2 storage, never to the app server disk.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const isImage = body.kind === "image";
    const target = await resolveTarget(body, isImage);
    if (isImage && (body.mediaId === undefined || body.mediaId === null || body.mediaId === "")) {
      // Posters may be uploaded before the new media record is created.
      target.mediaId = null;
    }
    if (!isImage && body.quality === undefined) throw new ApiError(400, "Choose 720p, 1080p, or Other quality before uploading");
    const upload = await initializeUpload({ kind: body.kind, fileName: body.fileName, sizeBytes: body.sizeBytes, contentType: body.contentType, target });
    return NextResponse.json(upload, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
