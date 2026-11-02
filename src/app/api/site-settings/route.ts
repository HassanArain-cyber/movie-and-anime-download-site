import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getUpload } from "@/lib/storage";
import { ApiError, errorResponse, imageUrl, readJson, uuid } from "@/lib/validation";

const WALLPAPER_KEY = "background_wallpaper_url";
const NO_STORE = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

/** Publicly readable appearance setting; the referenced R2 image remains private. */
export async function GET() {
  try {
    const [setting] = await db.select({ value: siteSettings.value })
      .from(siteSettings).where(eq(siteSettings.key, WALLPAPER_KEY)).limit(1);
    return NextResponse.json({ wallpaperUrl: setting?.value ?? null }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Only an authenticated admin can apply/replace the public wallpaper. */
export async function PUT(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const wallpaperUrl = imageUrl(body.wallpaperUrl, "Wallpaper URL");
    if (!wallpaperUrl) throw new ApiError(400, "Choose an image before applying the wallpaper");

    // The existing image proxy is intentionally limited to verified image uploads.
    if (wallpaperUrl.startsWith("/api/image?")) {
      const uploadId = new URL(wallpaperUrl, "http://local").searchParams.get("upload");
      const upload = await getUpload(uuid(uploadId, "Wallpaper upload"));
      if (upload.kind !== "image" || upload.status !== "completed") {
        throw new ApiError(400, "Wallpaper must use a completed image upload");
      }
    }

    const [setting] = await db.insert(siteSettings).values({ key: WALLPAPER_KEY, value: wallpaperUrl })
      .onConflictDoUpdate({ target: siteSettings.key, set: { value: wallpaperUrl, updatedAt: new Date() } })
      .returning({ value: siteSettings.value });
    return NextResponse.json({ wallpaperUrl: setting.value }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Clear only the setting; uploaded R2 images are retained like other media objects. */
export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    await db.delete(siteSettings).where(eq(siteSettings.key, WALLPAPER_KEY));
    return NextResponse.json({ wallpaperUrl: null }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
