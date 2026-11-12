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
  const maskable = variant === "maskable-512";
  const inset = maskable ? Math.round(size * 0.13) : Math.round(size * 0.022);
  let imageData: string;
  try {
    const bytes = await readFile(join(process.cwd(), "public", "icons", "anime_tracker_app_icon.png"));
    imageData = "data:image/png;base64," + bytes.toString("base64");
  } catch {
    const asset = await fetch(new URL("/icons/anime_tracker_app_icon.png", request.url));
    if (!asset.ok) return new Response("Icon unavailable", { status: 503 });
    imageData = "data:image/png;base64," + Buffer.from(await asset.arrayBuffer()).toString("base64");
  }

  const radius = Math.round(size * 0.18);
  const frame = size - inset * 2;
  const border = Math.max(2, Math.round(size * 0.012));
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#10071f" }}>
        <div style={{ width: frame, height: frame, display: "flex", borderRadius: radius, overflow: "hidden", border: `${border}px solid #d28cff`, backgroundColor: "#270b40" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageData} alt="" width={frame} height={frame} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
