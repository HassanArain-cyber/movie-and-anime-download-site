import { after, NextResponse } from "next/server";
import { safelyProcessNotifications } from "@/lib/notifications/worker";
import { db } from "@/db";
import { downloadLinks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { resolveTarget } from "@/lib/library";
import { getQuality } from "@/lib/media-links";
import { getUpload, r2LinkValues } from "@/lib/storage";
import { errorResponse, externalUrl, linkBehavior, quality, readJson, text, uuid, websiteUrl } from "@/lib/validation";
import type { VideoQuality } from "@/lib/types";

export const maxDuration = 30;
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const target = await resolveTarget(body, false, true);
    const selectedQuality = quality(body.quality);
    const label = text(body.label, "Label", 50) || selectedQuality || "Download";
    // Omitted means "open", so existing clients and legacy payloads keep working.
    const behavior = body.linkBehavior === undefined || body.linkBehavior === null || body.linkBehavior === ""
      ? "open" : linkBehavior(body.linkBehavior);
    const afterCopyUrl = websiteUrl(body.afterCopyUrl);
    let values: typeof downloadLinks.$inferInsert;
    if (body.r2UploadId !== undefined && body.r2UploadId !== null && body.r2UploadId !== "") {
      const upload = await getUpload(uuid(body.r2UploadId, "r2UploadId"));
      const explicitSize = text(body.fileSize, "File size", 30);
      const uploadTarget = { ...target, quality: selectedQuality ?? upload.quality as VideoQuality | null };
      values = { ...r2LinkValues(upload, uploadTarget), label, linkBehavior: behavior, afterCopyUrl, ...(explicitSize ? { fileSize: explicitSize } : {}) };
    } else {
      const url = externalUrl(body.url);
      values = {
        url, label, fileSize: text(body.fileSize, "File size", 30),
        quality: selectedQuality ?? getQuality({ quality: null, label }),
        storageProvider: url.startsWith("https://t.me/") || url.startsWith("https://telegram.me/") || url.startsWith("tg:") ? "telegram" : "external",
        isUploaded: false, objectKey: null, sizeBytes: null, linkBehavior: behavior, afterCopyUrl,
      };
    }
    const [link] = await db.insert(downloadLinks).values({ ...target, ...values }).returning();
    after(safelyProcessNotifications);
    return NextResponse.json(link, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
