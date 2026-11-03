import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, media } from "@/db/schema";
import { ApiError } from "./validation";
import type { CommentReportReason } from "./comment-validation";

export { COMMENT_REPORT_REASONS, parseCommentBody, parseReportDetails, parseReportReason, parseSpoiler } from "./comment-validation";
export type { CommentReportReason } from "./comment-validation";

export type CommentTarget = { mediaId: number; episodeId: number | null; enabled: boolean };

export async function resolveCommentTarget(mediaId: number, episodeId: number | null): Promise<CommentTarget> {
  const [item] = await db.select({ id: media.id, commentsEnabled: media.commentsEnabled })
    .from(media).where(eq(media.id, mediaId)).limit(1);
  if (!item) throw new ApiError(404, "Media item not found");
  if (episodeId === null) return { mediaId, episodeId: null, enabled: item.commentsEnabled };
  const [episode] = await db.select({ id: episodes.id, commentsEnabled: episodes.commentsEnabled })
    .from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.mediaId, mediaId))).limit(1);
  if (!episode) throw new ApiError(404, "Episode not found for this title");
  return { mediaId, episodeId, enabled: item.commentsEnabled && episode.commentsEnabled };
}

export function requireCommentsEnabled(enabled: boolean): void {
  if (!enabled) throw new ApiError(403, "Comments are disabled for this content");
}
