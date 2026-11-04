import { NextResponse } from "next/server";
import { db } from "@/db";
import { commentReports } from "@/db/schema";
import { getCommentSession, setCommentSessionCookie } from "@/lib/comment-session";
import { enforceCommentRateLimit } from "@/lib/comment-rate-limit";
import { isCommentPubliclyVisible, parseReportDetails, parseReportReason } from "@/lib/comments";
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
    if (!(await isCommentPubliclyVisible(commentId))) throw new ApiError(404, "Comment not found");
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
