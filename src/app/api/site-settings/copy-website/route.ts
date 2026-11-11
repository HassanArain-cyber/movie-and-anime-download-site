import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { COPY_WEBSITE_KEY, getCopyWebsite } from "@/lib/site-settings";
import { ApiError, errorResponse, readJson, websiteUrl } from "@/lib/validation";

const NO_STORE = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

/** Admin view of the saved website. Public pages receive it together with the media data. */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    return NextResponse.json({ url: await getCopyWebsite() }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Save or replace the website. Blank is rejected: removing it is the explicit DELETE below. */
export async function PUT(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const url = websiteUrl((await readJson(req)).url);
    if (!url) throw new ApiError(400, "Enter a website address, or use Remove to delete the saved one");
    await db.insert(siteSettings).values({ key: COPY_WEBSITE_KEY, value: url })
      .onConflictDoUpdate({ target: siteSettings.key, set: { value: url, updatedAt: new Date() } });
    return NextResponse.json({ url }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Copy Link buttons without their own website go back to copy only. */
export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    await db.delete(siteSettings).where(eq(siteSettings.key, COPY_WEBSITE_KEY));
    return NextResponse.json({ url: null }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
