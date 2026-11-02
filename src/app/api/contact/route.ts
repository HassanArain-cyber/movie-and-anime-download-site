import { NextResponse } from "next/server";
import { consumeContactAttempt } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";
import { validateContactRequest } from "@/lib/contact-request";
import { sendContactEmail } from "@/lib/contact-email";
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
    // sending mail. A successful response is reserved for provider acceptance.
    if (typeof body.company === "string" && body.company.trim()) {
      throw new ApiError(400, "Unable to submit this request.");
    }

    const request = validateContactRequest(body);
    await sendContactEmail(request);
    return NextResponse.json({ success: true }, { headers: HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
