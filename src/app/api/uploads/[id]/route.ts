import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { abortUpload, completedUpload, getUpload, refreshUpload } from "@/lib/storage";
import { errorResponse, uuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

// Refresh part URLs / inspect status. Existing completed parts are reported so
// a retry does not upload them again.
export async function GET(req: Request, { params }: Context) {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    const id = uuid((await params).id);
    const row = await getUpload(id);
    const result = row.status === "pending" ? await refreshUpload(id) : row.status === "completed" ? completedUpload(row) : { id, status: row.status };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

// Cancel an incomplete multipart upload. Completed objects are always retained.
export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    await abortUpload(uuid((await params).id));
    return NextResponse.json({ success: true, objectRetained: true });
  } catch (error) { return errorResponse(error); }
}
