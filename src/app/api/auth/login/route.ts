import { NextResponse } from "next/server";
import { isAdminConfigured, login } from "@/lib/auth";
import { readJson, text, errorResponse, ApiError } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    if (!isAdminConfigured()) throw new ApiError(503, "Admin login is not configured. Set ADMIN_PASSWORD to at least 8 characters on the server.");
    const body = await readJson(req);
    const password = text(body.password, "Password", 1024, true)!;
    if (!(await login(password))) throw new ApiError(401, "Invalid password");
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
