import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { ApiError, errorResponse, positiveId, readJson, text } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const body = await readJson(req);
    const name = text(body.name, "Name", 100, true)!;
    const [updated] = await db.update(categories).set({ name, slug: slugify(name) }).where(eq(categories.id, id)).returning();
    if (!updated) throw new ApiError(404, "Category not found");
    return NextResponse.json(updated);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const [deleted] = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });
    if (!deleted) throw new ApiError(404, "Category not found");
    return NextResponse.json({ success: true });
  } catch (error) { return errorResponse(error); }
}
