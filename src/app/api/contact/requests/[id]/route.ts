import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contactRequests } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id, "Request ID");
    const [deleted] = await db.delete(contactRequests)
      .where(eq(contactRequests.id, id))
      .returning({ id: contactRequests.id });
    if (!deleted) throw new ApiError(404, "Request not found.");
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
