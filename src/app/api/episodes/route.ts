import { NextResponse } from "next/server";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export async function POST(req: Request) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  try {
    const { mediaId, seasonId, episodeNumber, title, duration } =
      await req.json();
    if (!mediaId || !seasonId || !episodeNumber) {
      return NextResponse.json(
        { error: "mediaId, seasonId, episodeNumber are required" },
        { status: 400 }
      );
    }
    const [ep] = await db
      .insert(episodes)
      .values({
        mediaId: Number(mediaId),
        seasonId: Number(seasonId),
        episodeNumber: Number(episodeNumber),
        title: title || null,
        duration: duration || null,
      })
      .returning();
    return NextResponse.json(ep, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
