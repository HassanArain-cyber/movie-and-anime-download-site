import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { activeContent } from "@/lib/content-state";
import { getUpload, signedObjectUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Public JPEG social image showing the ACTUAL poster, with a blurred version
 * of the same poster filling the landscape background. This works with R2
 * WebP originals and does not rely on OG image SVG/WebP rendering support.
 * The original private R2 object is never exposed in the response.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("upload");
  if (!id || !UPLOAD_ID.test(id)) return new Response("Not found", { status: 404 });

  const uploadId = id.toLowerCase();
  const posterPath = "/api/image?upload=" + uploadId;
  try {
    // Only publish the poster for an active item in the public catalog.
    const [title] = await db.select({ id: media.id }).from(media).where(and(
      eq(media.posterUrl, posterPath),
      await activeContent("media", media.id),
    )).limit(1);
    if (!title) return new Response("Not found", { status: 404 });

    const upload = await getUpload(uploadId);
    if (upload.kind !== "image" || upload.status !== "completed" ||
        !IMAGE_TYPES.includes(upload.contentType) || upload.sizeBytes > MAX_IMAGE_BYTES) {
      return new Response("Not found", { status: 404 });
    }

    const signed = await signedObjectUrl(upload);
    const image = await fetch(signed, { signal: AbortSignal.timeout(6500), cache: "no-store" });
    if (!image.ok) throw new Error("Poster download failed");
    const contentLength = Number(image.headers.get("content-length"));
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("Poster is too large");
    const raw = Buffer.from(await image.arrayBuffer());
    if (raw.length > MAX_IMAGE_BYTES) throw new Error("Poster is too large");

    // Sharp decodes JPEG/PNG/WebP reliably, unlike the previous OG renderer
    // which produced a purple text card with the WebP poster omitted.
    const imageOptions = { limitInputPixels: 40_000_000, failOn: "error" as const };
    const backdrop = await sharp(raw, imageOptions)
      .resize(1200, 630, { fit: "cover", position: "centre" })
      .blur(30)
      .modulate({ brightness: 0.55 })
      .jpeg({ quality: 78 })
      .toBuffer();
    const cover = await sharp(raw, imageOptions)
      .resize(414, 582, { fit: "contain", background: "#1a1229" })
      .jpeg({ quality: 84 })
      .toBuffer();
    const card = await sharp(backdrop)
      .composite([{ input: cover, left: 393, top: 24 }])
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return new Response(new Uint8Array(card), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Social image unavailable", {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
