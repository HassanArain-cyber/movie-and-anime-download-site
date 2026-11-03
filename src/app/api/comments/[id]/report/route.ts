import { NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, commentReports } from "@/db/schema";
import { getCommentSession, setCommentSessionCookie } from "@/lib/comment-session";
import { enforceCommentRateLimit } from "@/lib/comment-rate-limit";
import { parseReportDetails, parseReportReason } from "@/lib/comments";
import { assertSameOrigin } from "@/lib/request-security";
import { ApiError, errorResponse, positiveId, readJson } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(req: Request, { params }: Context) {
  let session: ReturnType<typeof getCommentSession> | undefined;
  try {
    assertSameOrigin(req);
    const commentId = positiveId((await params).id, "Comment ID");
    const body = await readJson(req, 8 * 1024);
    const reason = parseReportReason(body.reason);
    const details = parseReportDetails(body.details);
    session = getCommentSession(req);
    await enforceCommentRateLimit(req, session.hash);
    const [comment] = await db.select({ id: comments.id }).from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.isHidden, false), or(isNull(comments.parentId), sql`EXISTS (SELECT 1 FROM comments AS parent WHERE parent.id = ${comments.parentId} AND parent.is_hidden = false)`))).limit(1);
    if (!comment) throw new ApiError(404, "Comment not found");
    await db.insert(commentReports).values({ commentId, reporterHash: session.hash, reason, details });
    const response = NextResponse.json({ success: true }, { status: 201, headers: NO_STORE });
    setCommentSessionCookie(response, session);
    return response;
  } catch (error) {
    const response = errorResponse(error);
    if (session) setCommentSessionCookie(response, session);
    return response;
  }
}
