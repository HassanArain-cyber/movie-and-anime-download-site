import { NextResponse } from "next/server";
import { db } from "@/db";
import { downloadLinks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export async function POST(req: Request) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  try {
    const { mediaId, episodeId, label, url, fileSize, isUploaded } =
      await req.json();
    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    const [link] = await db
      .insert(downloadLinks)
      .values({
        mediaId: mediaId ? Number(mediaId) : null,
        episodeId: episodeId ? Number(episodeId) : null,
        label: label || "Download",
        url,
        fileSize: fileSize || null,
        isUploaded: isUploaded || false,
      })
      .returning();
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
