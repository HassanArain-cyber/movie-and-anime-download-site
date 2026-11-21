import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { downloadLinks, episodes, media } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { isLegacyUpload, isR2Url, getLinkProvider, safeExternalUrl } from "@/lib/media-links";
import { checkExternalLink } from "@/lib/link-health-server";
import { checkR2Object } from "@/lib/storage";
import { getMediaAuditHref, type LinkCheck } from "@/lib/link-health";
import { ApiError, errorResponse } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const PAGE_SIZE = 12;

type LinkRow = {
  id: number;
  mediaId: number | null;
  mediaTitle: string | null;
  mediaType: string | null;
  mediaSlug: string | null;
  episodeId: number | null;
  label: string | null;
  url: string;
  storageProvider: string | null;
  objectKey: string | null;
};

async function inspectLink(link: LinkRow): Promise<LinkCheck> {
  const provider = getLinkProvider(link as Parameters<typeof getLinkProvider>[0]);
  if (provider === "r2") {
    const key = link.objectKey || (isR2Url(link.url) ? link.url.slice(6) : null);
    if (!key) return { status: "broken", reason: "Missing R2 object reference." };
    const exists = await checkR2Object(key);
    return exists === "exists"
      ? { status: "reachable", reason: "Private R2 object exists." }
      : exists === "missing"
        ? { status: "broken", reason: "R2 object was not found." }
        : { status: "review", reason: "Could not confirm R2 object availability." };
  }
  if (isLegacyUpload(link.url)) {
    return { status: "review", reason: "Legacy local upload: check on its original server." };
  }
  if (!safeExternalUrl(link.url)) return { status: "broken", reason: "Unsupported or malformed URL." };
  // Telegram deep links and magnet links cannot be checked through HTTP HEAD.
  return checkExternalLink(link.url);
}

/** Admin-only, read-only, bounded check. Never follows arbitrary remote redirects. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth !== true) return auth;
  try {
    const raw = new URL(request.url).searchParams.get("offset") || "0";
    if (!/^(0|[1-9]\d{0,4})$/.test(raw)) throw new ApiError(400, "Invalid page offset.");
    const offset = Number(raw);
    const rows = await db.select({
      id: downloadLinks.id,
      // Old episode links may omit media_id; use the episode parent when present.
      mediaId: sql<number | null>`coalesce(${episodes.mediaId}, ${downloadLinks.mediaId})`,
      mediaTitle: media.title, mediaType: media.type, mediaSlug: media.slug,
      episodeId: downloadLinks.episodeId, label: downloadLinks.label,
      url: downloadLinks.url, storageProvider: downloadLinks.storageProvider,
      objectKey: downloadLinks.objectKey,
    }).from(downloadLinks)
      .leftJoin(episodes, eq(episodes.id, downloadLinks.episodeId))
      .leftJoin(media, eq(media.id, sql<number>`coalesce(${episodes.mediaId}, ${downloadLinks.mediaId})`))
      .orderBy(asc(downloadLinks.id)).limit(PAGE_SIZE + 1).offset(offset);

    // Small batches avoid saturating Vercel functions and remote providers.
    const checked = [];
    for (let i = 0; i < Math.min(rows.length, PAGE_SIZE); i += 4) {
      const group = rows.slice(i, i + 4);
      checked.push(...await Promise.all(group.map(async (item) => ({
        id: item.id, mediaId: item.mediaId, mediaTitle: item.mediaTitle,
        mediaType: item.mediaType,
        mediaHref: getMediaAuditHref(item.mediaType, item.mediaSlug, item.episodeId),
        label: item.label, provider: getLinkProvider(item as Parameters<typeof getLinkProvider>[0]),
        ...(await inspectLink(item)),
      }))));
    }
    return NextResponse.json({
      links: checked, nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
      note: "Reachable means the provider replied. Only 404/410 or missing R2 objects are confirmed broken.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
