import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

// Android's native splash uses the installed manifest icon.
export async function GET(request: NextRequest, context: { params: Promise<{ variant: string }> }) {
  const { variant } = await context.params;
  if (!["192", "512", "maskable-512"].includes(variant)) {
    return new Response("Not found", { status: 404 });
  }

  const size = variant === "192" ? 192 : 512;
  // Android may put transparent maskable pixels onto a white surface.
  // Render a full-bleed, opaque violet icon so there is no white or black border.
  const artSize = Math.ceil(size * 1.12);
  let imageData: string;
  try {
    const bytes = await readFile(join(process.cwd(), "public", "icons", "anime_tracker_app_icon.png"));
    imageData = "data:image/png;base64," + bytes.toString("base64");
  } catch {
    const asset = await fetch(new URL("/icons/anime_tracker_app_icon.png", request.url));
    if (!asset.ok) return new Response("Icon unavailable", { status: 503 });
    imageData = "data:image/png;base64," + Buffer.from(await asset.arrayBuffer()).toString("base64");
  }

  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "#200c38" }}>
        {/* Original artwork, shown larger to eliminate its empty transparent margin. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageData} alt="" width={artSize} height={artSize} style={{ width: artSize, height: artSize, objectFit: "cover", flexShrink: 0 }} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
