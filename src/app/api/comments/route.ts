import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { commentLikes, comments } from "@/db/schema";
import { getCommentSession, setCommentSessionCookie } from "@/lib/comment-session";
import { enforceCommentRateLimit } from "@/lib/comment-rate-limit";
import { parseCommentBody, parseSpoiler, requireCommentsEnabled, resolveCommentTarget } from "@/lib/comments";
import { assertSameOrigin } from "@/lib/request-security";
import { ApiError, errorResponse, positiveId, readJson } from "@/lib/validation";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const mediaId = positiveId(params.get("mediaId"), "mediaId");
    const episodeId = params.has("episodeId") ? positiveId(params.get("episodeId"), "episodeId") : null;
    const target = await resolveCommentTarget(mediaId, episodeId);
    const session = getCommentSession(req);
    const scope = [
      eq(comments.mediaId, mediaId),
      eq(comments.isHidden, false),
      episodeId === null ? isNull(comments.episodeId) : eq(comments.episodeId, episodeId),
      or(isNull(comments.parentId), sql`EXISTS (SELECT 1 FROM comments AS parent WHERE parent.id = ${comments.parentId} AND parent.is_hidden = false)`),
    ];
    const [rows, totals] = await Promise.all([
      db.select({
        id: comments.id,
        mediaId: comments.mediaId,
        episodeId: comments.episodeId,
        parentId: comments.parentId,
        body: comments.body,
        isSpoiler: comments.isSpoiler,
        createdAt: comments.createdAt,
        likeCount: sql<number>`(select count(*)::int from comment_likes where comment_id = ${comments.id})`,
        likedByMe: sql<boolean>`exists(select 1 from comment_likes where comment_id = ${comments.id} and session_hash = ${session.hash})`,
      }).from(comments).where(and(...scope)).orderBy(desc(comments.createdAt), desc(comments.id)).limit(120),
      db.select({ count: sql<number>`count(*)::int` }).from(comments).where(and(...scope)),
    ]);
    const response = NextResponse.json({
      comments: rows,
      count: Number(totals[0]?.count ?? 0),
      enabled: target.enabled,
      rules: "Keep discussion respectful and on-topic. No harassment, spam, illegal links, or personal information. Use spoiler labels and report concerns.",
    }, { headers: NO_STORE });
    setCommentSessionCookie(response, session);
    return response;
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  let session: ReturnType<typeof getCommentSession> | undefined;
  try {
    assertSameOrigin(req);
    const body = await readJson(req, 12 * 1024);
    const mediaId = positiveId(body.mediaId, "mediaId");
    const episodeId = body.episodeId === undefined || body.episodeId === null || body.episodeId === "" ? null : positiveId(body.episodeId, "episodeId");
    const target = await resolveCommentTarget(mediaId, episodeId);
    requireCommentsEnabled(target.enabled);
    session = getCommentSession(req);
    await enforceCommentRateLimit(req, session.hash);
    if (typeof body.website === "string" && body.website.trim()) {
      return NextResponse.json({ success: true }, { status: 201, headers: NO_STORE });
    }
    const text = parseCommentBody(body.body);
    const isSpoiler = parseSpoiler(body.isSpoiler);
    const parentId = body.parentId === undefined || body.parentId === null || body.parentId === "" ? null : positiveId(body.parentId, "parentId");
    if (parentId !== null) {
      const [parent] = await db.select({ id: comments.id, mediaId: comments.mediaId, episodeId: comments.episodeId, parentId: comments.parentId, isHidden: comments.isHidden })
        .from(comments).where(eq(comments.id, parentId)).limit(1);
      if (!parent || parent.isHidden || parent.mediaId !== mediaId || parent.episodeId !== episodeId) throw new ApiError(400, "Reply target is not part of this discussion");
      if (parent.parentId !== null) throw new ApiError(400, "Reply to the original comment thread, not another reply");
    }
    const duplicateConditions = [eq(comments.authorHash, session.hash), eq(comments.body, text), eq(comments.mediaId, mediaId), episodeId === null ? isNull(comments.episodeId) : eq(comments.episodeId, episodeId), sql`${comments.createdAt} > clock_timestamp() - interval '2 minutes'`];
    const [duplicate] = await db.select({ id: comments.id }).from(comments).where(and(...duplicateConditions)).limit(1);
    if (duplicate) throw new ApiError(409, "You recently posted the same comment. Please wait before repeating it.");
    const [created] = await db.insert(comments).values({
      mediaId,
      episodeId,
      parentId,
      authorHash: session.hash,
      body: text,
      isSpoiler,
    }).returning({ id: comments.id, createdAt: comments.createdAt });
    const response = NextResponse.json({ success: true, ...created }, { status: 201, headers: NO_STORE });
    setCommentSessionCookie(response, session);
    return response;
  } catch (error) {
    const response = errorResponse(error);
    if (session) setCommentSessionCookie(response, session);
    return response;
  }
}
