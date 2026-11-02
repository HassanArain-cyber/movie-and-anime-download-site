export const dynamic = "force-dynamic";

/** Public destination address for the user-initiated contact draft. */
export async function GET() {
  return Response.json(
    { adminEmail: process.env.ADMIN_EMAIL?.trim() || "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
