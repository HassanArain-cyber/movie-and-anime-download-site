import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id, "Comment ID");
    const body = await readJson(req);
    if (typeof body.isHidden !== "boolean") throw new ApiError(400, "isHidden must be true or false");
    const [updated] = await db.update(comments).set({ isHidden: body.isHidden }).where(eq(comments.id, id)).returning({ id: comments.id, isHidden: comments.isHidden });
    if (!updated) throw new ApiError(404, "Comment not found");
    return NextResponse.json(updated, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id, "Comment ID");
    const [deleted] = await db.delete(comments).where(eq(comments.id, id)).returning({ id: comments.id });
    if (!deleted) throw new ApiError(404, "Comment not found");
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
