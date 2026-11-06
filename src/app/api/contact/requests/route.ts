import { deleteAllAdminRecords } from "@/lib/admin-delete-all";
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { contactRequests } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, readJson, errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const requests = await db.select().from(contactRequests)
      .orderBy(desc(contactRequests.createdAt), desc(contactRequests.id));
    return NextResponse.json(requests, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

// Collection-wide deletion deliberately ignores listing filters and page limits.
export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req, 1024);
    if (body.confirm !== true) throw new ApiError(400, "Confirm Delete All before continuing.");
    const deleted = await deleteAllAdminRecords("requests");
    return NextResponse.json({ success: true, deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
