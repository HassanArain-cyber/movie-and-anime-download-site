import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Compatibility endpoint kept so old clients receive an actionable error rather
// than silently writing new media to ephemeral server disk. The admin UI now
// uses /api/uploads (browser -> private R2 multipart) and /api/image.
// Existing /uploads/... database records remain readable through /api/download.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  void req;
  return NextResponse.json({
    error: "Local uploads are disabled. Use the R2 upload control in the admin panel; existing local files and links are preserved.",
    replacement: "/api/uploads",
  }, { status: 410 });
}
