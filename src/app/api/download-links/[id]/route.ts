import { NextResponse } from "next/server";
import { db } from "@/db";
import { downloadLinks } from "@/db/schema";
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
    if ("label" in body) updates.label = body.label || "Download";
    if ("url" in body) updates.url = body.url;
    if ("fileSize" in body) updates.fileSize = body.fileSize || null;
    const [updated] = await db
      .update(downloadLinks)
      .set(updates)
      .where(eq(downloadLinks.id, Number(id)))
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
    await db.delete(downloadLinks).where(eq(downloadLinks.id, Number(id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
