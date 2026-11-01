import { NextResponse } from "next/server";
import { db } from "@/db";
import { downloadLinks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { resolveTarget } from "@/lib/library";
import { getQuality } from "@/lib/media-links";
import { getUpload, r2LinkValues } from "@/lib/storage";
import { errorResponse, externalUrl, quality, readJson, text, uuid } from "@/lib/validation";

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    const target = await resolveTarget(body, false, true);
    const selectedQuality = quality(body.quality);
    const label = text(body.label, "Label", 50) || selectedQuality || "Download";
    let values: typeof downloadLinks.$inferInsert;
    if (body.r2UploadId !== undefined && body.r2UploadId !== null && body.r2UploadId !== "") {
      const upload = await getUpload(uuid(body.r2UploadId, "r2UploadId"));
      const explicitSize = text(body.fileSize, "File size", 30);
      const uploadTarget = { ...target, quality: selectedQuality ?? upload.quality as "720p" | "1080p" | "other" | null };
      values = { ...r2LinkValues(upload, uploadTarget), label, ...(explicitSize ? { fileSize: explicitSize } : {}) };
    } else {
      const url = externalUrl(body.url);
      values = {
        url, label, fileSize: text(body.fileSize, "File size", 30),
        quality: selectedQuality ?? getQuality({ quality: null, label }),
        storageProvider: url.startsWith("https://t.me/") || url.startsWith("https://telegram.me/") || url.startsWith("tg:") ? "telegram" : "external",
        isUploaded: false, objectKey: null, sizeBytes: null,
      };
    }
    const [link] = await db.insert(downloadLinks).values({ ...target, ...values }).returning();
    return NextResponse.json(link, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
