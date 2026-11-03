import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { checkPreviewDatabaseTarget } from "@/lib/preview-db-target";

export const dynamic = "force-dynamic";

const EXPECTED_BRANCH = "arena/e243c098-movie-and-anime-download-site";
const EXPECTED_ENDPOINT = "ep-still-darkness-b5bsw66y";
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/**
 * Temporary, read-only diagnostic. It is available only on PR #3's Vercel
 * Preview deployment and to an authenticated admin. It reads DATABASE_URL in
 * memory, performs no database/network request, and returns only a match state.
 */
export async function GET(req: Request) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  const auth = await requireAdmin(req);
  if (auth !== true) return auth;

  return NextResponse.json(
    { target: checkPreviewDatabaseTarget(process.env.DATABASE_URL, EXPECTED_ENDPOINT) },
    { headers: NO_STORE },
  );
}
