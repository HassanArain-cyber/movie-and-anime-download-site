import { NextResponse } from "next/server";
import { isAdminConfigured, login } from "@/lib/auth";
import { consumeLoginAttempt } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/request-security";
import { readJson, text, errorResponse, ApiError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    if (!isAdminConfigured()) throw new ApiError(503, "Admin login is not configured. Set ADMIN_PASSWORD to at least 8 characters on the server.");
    // Count every attempt, including malformed bodies, before doing password work.
    const limit = await consumeLoginAttempt(req);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many login attempts. Please try again later." }, {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfter), "X-Content-Type-Options": "nosniff" },
      });
    }
    const body = await readJson(req, 16 * 1024);
    const password = text(body.password, "Password", 1024, true)!;
    if (!(await login(password))) throw new ApiError(401, "Invalid password");
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
