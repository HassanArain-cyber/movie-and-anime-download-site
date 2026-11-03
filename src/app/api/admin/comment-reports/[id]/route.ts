import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { commentReports } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError, errorResponse, positiveId, readJson } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
const VALID_STATUSES = ["pending", "reviewed", "resolved"] as const;

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id, "Report ID");
    const body = await readJson(req);
    if (typeof body.status !== "string" || !VALID_STATUSES.some((status) => status === body.status)) throw new ApiError(400, "Choose a valid report status");
    const [updated] = await db.update(commentReports).set({ status: body.status }).where(eq(commentReports.id, id)).returning({ id: commentReports.id, status: commentReports.status });
    if (!updated) throw new ApiError(404, "Report not found");
    return NextResponse.json(updated, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
