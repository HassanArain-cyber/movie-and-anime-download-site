import { NextResponse } from "next/server";
import { db } from "@/db";
import { seasons } from "@/db/schema";
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
    const { seasonNumber, name } = await req.json();
    const [updated] = await db
      .update(seasons)
      .set({
        seasonNumber: seasonNumber ? Number(seasonNumber) : undefined,
        name: name ?? undefined,
      })
      .where(eq(seasons.id, Number(id)))
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
    await db.delete(seasons).where(eq(seasons.id, Number(id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
