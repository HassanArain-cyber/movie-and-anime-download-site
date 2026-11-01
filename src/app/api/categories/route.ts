import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { errorResponse, readJson, text } from "@/lib/validation";

export async function GET() {
  try {
    const rows = await db.select().from(categories).orderBy(categories.name);
    return NextResponse.json(rows);
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const name = text(body.name, "Name", 100, true)!;
    const [cat] = await db.insert(categories).values({ name, slug: slugify(name) }).returning();
    return NextResponse.json(cat, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
