import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { commentLikes } from "@/db/schema";
import { getCommentSession, setCommentSessionCookie } from "@/lib/comment-session";
import { enforceCommentRateLimit } from "@/lib/comment-rate-limit";
import { isCommentPubliclyVisible } from "@/lib/comments";
import { assertSameOrigin } from "@/lib/request-security";
import { ApiError, errorResponse, positiveId } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

async function updateLike(req: Request, { params }: Context, liked: boolean) {
  let session: ReturnType<typeof getCommentSession> | undefined;
  try {
    assertSameOrigin(req);
    const commentId = positiveId((await params).id, "Comment ID");
    session = getCommentSession(req);
    await enforceCommentRateLimit(req, session.hash);
    if (!(await isCommentPubliclyVisible(commentId))) throw new ApiError(404, "Comment not found");
    if (liked) {
      await db.insert(commentLikes).values({ commentId, sessionHash: session.hash }).onConflictDoNothing();
    } else {
      await db.delete(commentLikes).where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.sessionHash, session.hash)));
    }
    const [total] = await db.select({ count: count() }).from(commentLikes).where(eq(commentLikes.commentId, commentId));
    const response = NextResponse.json({ liked, likeCount: Number(total?.count ?? 0) }, { headers: NO_STORE });
    setCommentSessionCookie(response, session);
    return response;
  } catch (error) {
    const response = errorResponse(error);
    if (session) setCommentSessionCookie(response, session);
    return response;
  }
}

export async function PUT(req: Request, context: Context) { return updateLike(req, context, true); }
export async function DELETE(req: Request, context: Context) { return updateLike(req, context, false); }
