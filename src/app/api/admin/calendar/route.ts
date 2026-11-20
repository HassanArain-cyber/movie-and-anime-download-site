import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getManualCalendarEntries, changeManualCalendarEntry } from "@/lib/calendar-store";
import { errorResponse, readJson } from "@/lib/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;
  try { return NextResponse.json({ entries: await getManualCalendarEntries() }, { headers }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;
  try {
    const body = await readJson(request, 16_384);
    const entries = await changeManualCalendarEntry("create", body);
    return NextResponse.json({ entries }, { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;
  try {
    const body = await readJson(request, 16_384);
    return NextResponse.json({ entries: await changeManualCalendarEntry("update", body) }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;
  try {
    const body = await readJson(request, 4096);
    return NextResponse.json({ entries: await changeManualCalendarEntry("delete", body) }, { headers });
  } catch (error) { return errorResponse(error); }
}
