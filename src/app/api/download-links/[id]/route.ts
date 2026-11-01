import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { downloadLinks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getQuality, isLegacyUpload, isR2Url } from "@/lib/media-links";
import { getUpload, r2LinkValues } from "@/lib/storage";
import { ApiError, errorResponse, externalUrl, positiveId, quality, readJson, text, uuid } from "@/lib/validation";
import type { VideoQuality } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    const body = await readJson(req);
    const [existing] = await db.select().from(downloadLinks).where(eq(downloadLinks.id, id)).limit(1);
    if (!existing) throw new ApiError(404, "Link not found");
    const updates: Partial<typeof downloadLinks.$inferInsert> = {};
    if ("label" in body) updates.label = text(body.label, "Label", 50) || "Download";
    if ("fileSize" in body) updates.fileSize = text(body.fileSize, "File size", 30);
    if ("quality" in body) updates.quality = quality(body.quality);
    const label = updates.label ?? existing.label;
    if (!("quality" in body)) updates.quality = getQuality({ quality: existing.quality as VideoQuality | null, label });

    if (body.r2UploadId) {
      const upload = await getUpload(uuid(body.r2UploadId, "r2UploadId"));
      Object.assign(updates, r2LinkValues(upload, { mediaId: existing.mediaId, seasonId: existing.seasonId, episodeId: existing.episodeId, quality: (updates.quality ?? null) as VideoQuality | null }));
      updates.label = label;
    } else if ("url" in body && body.url !== existing.url) {
      if (isR2Url(existing.url) || isLegacyUpload(existing.url) || existing.storageProvider === "r2") {
        throw new ApiError(400, "Replace stored files with a new R2 upload; existing object references cannot be rewritten to an external URL");
      }
      const url = externalUrl(body.url);
      updates.url = url;
      updates.storageProvider = url.startsWith("https://t.me/") || url.startsWith("https://telegram.me/") || url.startsWith("tg:") ? "telegram" : "external";
      updates.isUploaded = false;
      updates.objectKey = null;
      updates.sizeBytes = null;
    }
    const [updated] = await db.update(downloadLinks).set(updates).where(eq(downloadLinks.id, id)).returning();
    return NextResponse.json(updated);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const id = positiveId((await params).id);
    // Delete only the link record. R2 objects and upload audit records are retained.
    const [deleted] = await db.delete(downloadLinks).where(eq(downloadLinks.id, id)).returning({ id: downloadLinks.id });
    if (!deleted) throw new ApiError(404, "Link not found");
    return NextResponse.json({ success: true, objectRetained: true });
  } catch (error) { return errorResponse(error); }
}
