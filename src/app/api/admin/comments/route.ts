import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, commentReports, episodes, media, seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const params = new URL(req.url).searchParams;
    if (params.get("view") === "all") {
      const allComments = await db.select({
        id: comments.id,
        parentId: comments.parentId,
        body: comments.body,
        isSpoiler: comments.isSpoiler,
        isHidden: comments.isHidden,
        createdAt: comments.createdAt,
        reportCount: sql<number>`(SELECT count(*)::int FROM comment_reports WHERE comment_id = ${comments.id})`,
        mediaId: media.id,
        mediaTitle: media.title,
        mediaType: media.type,
        episodeId: episodes.id,
        episodeNumber: episodes.episodeNumber,
        episodeTitle: episodes.title,
        seasonNumber: seasons.seasonNumber,
      }).from(comments)
        .innerJoin(media, eq(comments.mediaId, media.id))
        .leftJoin(episodes, eq(comments.episodeId, episodes.id))
        .leftJoin(seasons, eq(episodes.seasonId, seasons.id))
        .orderBy(desc(comments.createdAt), desc(comments.id))
        .limit(200);
      return NextResponse.json({ comments: allComments }, { headers: { "Cache-Control": "no-store" } });
    }
    const status = params.get("status");
    const reports = await db.select({
      id: commentReports.id,
      commentId: comments.id,
      reason: commentReports.reason,
      details: commentReports.details,
      status: commentReports.status,
      reportedAt: commentReports.createdAt,
      commentBody: comments.body,
      isSpoiler: comments.isSpoiler,
      isHidden: comments.isHidden,
      commentCreatedAt: comments.createdAt,
      mediaId: media.id,
      mediaTitle: media.title,
      mediaType: media.type,
      episodeId: episodes.id,
      episodeNumber: episodes.episodeNumber,
      episodeTitle: episodes.title,
      seasonNumber: seasons.seasonNumber,
    }).from(commentReports)
      .innerJoin(comments, eq(commentReports.commentId, comments.id))
      .innerJoin(media, eq(comments.mediaId, media.id))
      .leftJoin(episodes, eq(comments.episodeId, episodes.id))
      .leftJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(status ? eq(commentReports.status, status) : undefined)
      .orderBy(desc(commentReports.createdAt), desc(commentReports.id))
      .limit(200);
    return NextResponse.json(reports, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
