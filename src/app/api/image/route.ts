import { NextResponse } from "next/server";
import { getUpload, signedObjectUrl } from "@/lib/storage";
import { ApiError, errorResponse, uuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Posters are public, but the bucket remains private. This endpoint can only
// resolve a completed image upload, never an arbitrary object key or video.
export async function GET(req: Request) {
  try {
    const id = uuid(new URL(req.url).searchParams.get("upload"), "upload");
    const row = await getUpload(id);
    if (row.kind !== "image" || row.status !== "completed") throw new ApiError(404, "Image not found");
    const url = await signedObjectUrl(row);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
