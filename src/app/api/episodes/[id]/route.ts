import { NextResponse } from "next/server";
import { db } from "@/db";
import { episodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;
  const { id } = await params;
  try {
    const body = await req.json();
    const updates: Record<string, any> = {};
    if ("episodeNumber" in body) updates.episodeNumber = body.episodeNumber ? Number(body.episodeNumber) : undefined;
    if ("title" in body) updates.title = body.title || null;
    if ("duration" in body) updates.duration = body.duration || null;
    if ("seasonId" in body) updates.seasonId = body.seasonId ? Number(body.seasonId) : undefined;
    const [updated] = await db
      .update(episodes)
      .set(updates)
      .where(eq(episodes.id, Number(id)))
      .returning();
    return NextResponse.json(updated);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireAdmin();
  if (authCheck !== true) return authCheck;
  const { id } = await params;
  try {
    await db.delete(episodes).where(eq(episodes.id, Number(id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
