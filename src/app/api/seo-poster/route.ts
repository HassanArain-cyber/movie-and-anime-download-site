import { ImageResponse } from "next/og";
import { createElement } from "react";
import { getUpload, signedObjectUrl } from "@/lib/storage";
import { ApiError, errorResponse, uuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WhatsApp needs a stable, publicly readable image response. A signed R2
// redirect expires and may serve an image that exceeds preview size limits.
export async function GET(req: Request): Promise<Response> {
  try {
    const uploadId = uuid(new URL(req.url).searchParams.get("upload"), "upload");
    const upload = await getUpload(uploadId);
    if (
      upload.kind !== "image" ||
      upload.status !== "completed" ||
      upload.sizeBytes > 10 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(upload.contentType)
    ) {
      throw new ApiError(404, "Poster not found");
    }

    // The URL is generated exclusively from the validated R2 image record.
    // Never accept arbitrary URLs or expose the signed URL to the caller.
    const posterSource = await signedObjectUrl(upload);
    const poster = createElement("img", {
      src: posterSource,
      alt: "Anime or movie poster",
      width: 380,
      height: 540,
      style: {
        width: 380,
        height: 540,
        objectFit: "contain",
        borderRadius: 20,
      },
    });
    const layout = createElement(
      "div",
      {
        style: {
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          gap: 55,
          background: "linear-gradient(135deg, #10101d 0%, #24143d 100%)",
          color: "#ffffff",
          padding: 35,
        },
      },
      createElement(
        "div",
        {
          style: {
            display: "flex",
            width: 420,
            height: 560,
            justifyContent: "center",
            alignItems: "center",
            borderRadius: 24,
            backgroundColor: "#16131f",
          },
        },
        poster,
      ),
      createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 540,
            gap: 24,
          },
        },
        createElement("div", { style: { fontSize: 68, fontWeight: 800, letterSpacing: -2 } }, "GOJO'S VAULT"),
        createElement("div", { style: { fontSize: 32, color: "#d3b9ff" } }, "Anime · Movies · Series"),
      ),
    );

    return new ImageResponse(layout, {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
