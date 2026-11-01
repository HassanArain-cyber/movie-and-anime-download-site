import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await isAdmin();
  return NextResponse.json({ authed }, { headers: { "Cache-Control": "no-store" } });
}
