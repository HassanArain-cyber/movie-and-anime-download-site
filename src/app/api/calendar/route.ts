import { NextResponse } from "next/server";
import { getCalendarData } from "@/lib/calendar-data";
import { parseCalendarMonth } from "@/lib/calendar-model";
import { ApiError, errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    let period: { year: number; month: number };
    try { period = parseCalendarMonth(url.searchParams.get("year"), url.searchParams.get("month")); }
    catch { throw new ApiError(400, "Choose a valid year and month"); }
    const data = await getCalendarData(period.year, period.month);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
