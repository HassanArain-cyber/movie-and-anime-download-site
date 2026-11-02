import { NextResponse } from "next/server";
import { db } from "@/db";
import { contactRequests } from "@/db/schema";
import { consumeContactAttempt } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";
import { validateContactRequest } from "@/lib/contact-request";
import { ApiError, errorResponse, readJson } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const limit = await consumeContactAttempt(req);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, {
        status: 429,
        headers: { ...HEADERS, "Retry-After": String(limit.retryAfter) },
      });
    }

    const body = await readJson(req, 8 * 1024);
    // Honeypot: bots that fill the visually hidden field are rejected without
    // creating a database record. Success is reserved for a committed insert.
    if (typeof body.company === "string" && body.company.trim()) {
      throw new ApiError(400, "Unable to submit this request.");
    }

    const request = validateContactRequest(body);
    let saved: { id: number } | undefined;
    try {
      [saved] = await db.insert(contactRequests).values({ name: request.name, requestType: request.type, message: request.message }).returning({ id: contactRequests.id });
    } catch (error) {
      console.error("Contact request save failed:", (error as { code?: string })?.code ?? "unknown");
      throw new ApiError(503, "We couldn’t save your request right now. Please try again later.");
    }
    if (!saved) throw new ApiError(503, "We couldn’t confirm that your request was saved. Please try again.");

    return NextResponse.json({ success: true, id: saved.id }, { status: 201, headers: HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
