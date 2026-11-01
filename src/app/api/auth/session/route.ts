import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";

export async function GET() {
  const authed = await isAdmin();
  return NextResponse.json({ authed });
}
