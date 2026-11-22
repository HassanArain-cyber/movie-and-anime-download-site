import { ImageResponse } from "next/og";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { activeContent } from "@/lib/content-state";
import { getUpload, signedObjectUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Small, publicly crawlable card for an ACTIVE title's completed R2 poster.
 * Never accepts an object key or arbitrary image URL supplied by the caller.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("upload");
  if (!id || !UPLOAD_ID.test(id)) return new Response("Not found", { status: 404 });

  const posterPath = "/api/image?upload=" + id.toLowerCase();
  try {
    const [title] = await db.select({
      name: media.title,
      type: media.type,
    }).from(media).where(and(
      eq(media.posterUrl, posterPath),
      await activeContent("media", media.id),
    )).limit(1);
    if (!title) return new Response("Not found", { status: 404 });

    const upload = await getUpload(id.toLowerCase());
    if (upload.kind !== "image" || upload.status !== "completed" ||
        !["image/jpeg", "image/png", "image/webp"].includes(upload.contentType)) {
      return new Response("Not found", { status: 404 });
    }

    // The URL is signed internally for this known upload only. It is never
    // returned to the caller; the output is a compact, branded PNG.
    const signed = await signedObjectUrl(upload);
    const image = await fetch(signed, { signal: AbortSignal.timeout(6500) });
    if (!image.ok) throw new Error("Poster image unavailable");
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Poster too large");
    const source = "data:" + upload.contentType + ";base64," + Buffer.from(bytes).toString("base64");

    return new ImageResponse(
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center",
        background: "linear-gradient(110deg, #171028 0%, #26133f 100%)",
        padding: 28, color: "white", gap: 26,
      }}>
        <div style={{
          display: "flex", flexShrink: 0, width: 160, height: 245,
          overflow: "hidden", borderRadius: 12,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source} alt="" width={160} height={245} style={{ width: 160, height: 245, objectFit: "cover" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", color: "#d7b5ff", fontSize: 17, fontWeight: 700, marginBottom: 16 }}>GOJO'S VAULT</div>
          <div style={{ display: "flex", fontSize: 37, fontWeight: 750, lineHeight: 1.16, wordBreak: "break-word" }}>
            {title.name.length > 85 ? title.name.slice(0, 82) + "…" : title.name}
          </div>
          <div style={{ display: "flex", color: "#ded4ea", fontSize: 19, marginTop: 14, textTransform: "capitalize" }}>
            {title.type === "series" ? "TV Series" : title.type}
          </div>
        </div>
      </div>,
      { width: 600, height: 315, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
    );
  } catch {
    return new Response("Social image unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
