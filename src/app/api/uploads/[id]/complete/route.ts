import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { completeUpload } from "@/lib/storage";
import { errorResponse, uuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    const result = await completeUpload(uuid((await params).id));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
