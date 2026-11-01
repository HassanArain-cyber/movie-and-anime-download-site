import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getStorageStatus } from "@/lib/storage";
import { errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (auth !== true) return auth;
  try {
    return NextResponse.json(getStorageStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
