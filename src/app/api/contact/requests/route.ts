import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { contactRequests } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const requests = await db.select().from(contactRequests)
      .orderBy(desc(contactRequests.createdAt), desc(contactRequests.id));
    return NextResponse.json(requests, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
