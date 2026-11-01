import { NextResponse } from "next/server";
import { logout } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-security";
import { errorResponse } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await logout();
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
