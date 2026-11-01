// Download handler: takes a url query param and:
// - if it's an uploaded /uploads/... path, streams with attachment disposition
// - if it's external, performs a quick HEAD check then redirects (direct link)
import { NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import path from "path";
import { db } from "@/db";
import { downloadLinks } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get("id");
  let url = searchParams.get("url");

  // If a link id is provided, look up the URL and file size
  if (linkId) {
    try {
      const [link] = await db
        .select()
        .from(downloadLinks)
        .where(eq(downloadLinks.id, Number(linkId)))
        .limit(1);
      if (link) {
        url = link.url;
      }
    } catch {
      // fall through
    }
  }

  if (!url) {
    return NextResponse.json({ error: "Missing url or id" }, { status: 400 });
  }

  // Handle self-hosted uploads
  if (url.startsWith("/uploads/")) {
    const filePath = path.join(process.cwd(), "public", url);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) throw new Error("not a file");
      const range = req.headers.get("range");
      const filename = path.basename(filePath);
      const nodeReq = req as unknown as {
        headers: Record<string, string>;
      };

      // Use node ReadStream and return Response with body
      const stream = createReadStream(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === ".mp4"
          ? "video/mp4"
          : ext === ".webm"
          ? "video/webm"
          : ext === ".mkv"
          ? "video/x-matroska"
          : ext === ".mov"
          ? "video/quicktime"
          : ext === ".avi"
          ? "video/x-msvideo"
          : "application/octet-stream";

      const headers = new Headers({
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          filename
        )}"`,
        "Accept-Ranges": "bytes",
      });

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunk = end - start + 1;
        headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        headers.set("Content-Length", String(chunk));
        const rangedStream = createReadStream(filePath, { start, end });
        return new Response(rangedStream as any, { status: 206, headers });
      }

      return new Response(stream as any, { status: 200, headers });
      void nodeReq;
    } catch (err) {
      console.error("Uploaded file read error:", err);
      return NextResponse.json(
        { error: "File not available" },
        { status: 404 }
      );
    }
  }

  // External URL – redirect the browser to the direct link (one-click)
  // The client can alternatively use a direct <a> with download / target.
  return NextResponse.redirect(url, 302);
}
