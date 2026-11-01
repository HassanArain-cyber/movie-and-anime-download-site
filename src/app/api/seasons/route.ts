import { NextResponse } from "next/server";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";

// POST /api/seasons - add a season (admin)
export async function POST(req: Request) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;

  try {
    const { mediaId, seasonNumber, name } = await req.json();
    if (!mediaId || !seasonNumber) {
      return NextResponse.json(
        { error: "mediaId and seasonNumber are required" },
        { status: 400 }
      );
    }
    const [season] = await db
      .insert(seasons)
      .values({
        mediaId: Number(mediaId),
        seasonNumber: Number(seasonNumber),
        name: name || null,
      })
      .returning();
    return NextResponse.json(season, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
