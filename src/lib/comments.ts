import "server-only";
import { assertActiveContent } from "./content-state";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, episodes, media } from "@/db/schema";
import { ApiError } from "./validation";
import type { CommentReportReason } from "./comment-validation";

export { COMMENT_REPORT_REASONS, parseCommentBody, parseReportDetails, parseReportReason, parseSpoiler } from "./comment-validation";
export type { CommentReportReason } from "./comment-validation";

export type CommentTarget = { mediaId: number; episodeId: number | null; enabled: boolean };

/** Payload is bounded, but reply depth is not. Ancestors are ordered first. */
export const PUBLIC_COMMENT_LIMIT = 500;

export type PublicComment = {
  id: number;
  mediaId: number;
  episodeId: number | null;
  parentId: number | null;
  body: string;
  isSpoiler: boolean;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
};

type RawPublicCommentRow = Omit<PublicComment, "createdAt"> & {
  createdAt: Date | string;
  visibleCount: number;
};

export async function resolveCommentTarget(mediaId: number, episodeId: number | null): Promise<CommentTarget> {
  await assertActiveContent("media", mediaId);
  if (episodeId !== null) await assertActiveContent("episode", episodeId);
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

/**
 * Read a whole discussion with unbounded reply depth.
 *
 * `comments.parent_id` already exists as a self-referencing FK with ON DELETE
 * CASCADE, so no migration is required. A recursive CTE walks down from every
 * visible root: hiding any ancestor hides its entire subtree, not just its
 * immediate children. The query returns only bounded plain-text fields; author
 * and session hashes stay on the server.
 */
export async function listPublicComments(
  mediaId: number,
  episodeId: number | null,
  sessionHash: string,
): Promise<{ comments: PublicComment[]; count: number }> {
  const scope = episodeId === null
    ? sql`c.media_id = ${mediaId} AND c.episode_id IS NULL`
    : sql`c.media_id = ${mediaId} AND c.episode_id = ${episodeId}`;
  const result = await db.execute(sql`
    WITH RECURSIVE visible_thread(id, root_id, root_created_at) AS (
      SELECT c.id, c.id, c.created_at
      FROM comments c
      WHERE ${scope} AND c.parent_id IS NULL AND c.is_hidden = false
      UNION
      SELECT c.id, v.root_id, v.root_created_at
      FROM comments c
      JOIN visible_thread v ON c.parent_id = v.id
      WHERE ${scope} AND c.is_hidden = false
    ), visible AS (
      SELECT DISTINCT id, root_id, root_created_at FROM visible_thread
    )
    SELECT
      c.id,
      c.media_id AS "mediaId",
      c.episode_id AS "episodeId",
      c.parent_id AS "parentId",
      c.body,
      c.is_spoiler AS "isSpoiler",
      c.created_at AS "createdAt",
      (SELECT count(*)::int FROM comment_likes WHERE comment_id = c.id) AS "likeCount",
      EXISTS (SELECT 1 FROM comment_likes WHERE comment_id = c.id AND session_hash = ${sessionHash}) AS "likedByMe",
      count(*) OVER () AS "visibleCount"
    FROM comments c
    JOIN visible v ON v.id = c.id
    ORDER BY v.root_created_at DESC, v.root_id DESC, c.created_at ASC, c.id ASC
    LIMIT ${PUBLIC_COMMENT_LIMIT}
  `);
  const rows = result.rows as unknown as RawPublicCommentRow[];
  return {
    comments: rows.map((row) => ({
      id: row.id,
      mediaId: row.mediaId,
      episodeId: row.episodeId,
      parentId: row.parentId,
      body: row.body,
      isSpoiler: Boolean(row.isSpoiler),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
      likeCount: Number(row.likeCount) || 0,
      likedByMe: Boolean(row.likedByMe),
    })),
    count: Number(rows[0]?.visibleCount ?? 0),
  };
}

/**
 * Is this comment publicly reachable through an unbroken chain of visible
 * ancestors? UNION (not UNION ALL) also terminates safely on malformed cycles.
 */
export async function isCommentPubliclyVisible(commentId: number): Promise<boolean> {
  const [target] = await db.select({ mediaId: comments.mediaId, episodeId: comments.episodeId }).from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!target) return false;
  await resolveCommentTarget(target.mediaId, target.episodeId);
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors(id, parent_id, is_hidden) AS (
      SELECT c.id, c.parent_id, c.is_hidden FROM comments c WHERE c.id = ${commentId}
      UNION
      SELECT c.id, c.parent_id, c.is_hidden
      FROM comments c JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT (
      EXISTS (SELECT 1 FROM ancestors WHERE id = ${commentId})
      AND NOT EXISTS (SELECT 1 FROM ancestors WHERE is_hidden)
    ) AS visible
  `);
  return Boolean((result.rows[0] as { visible?: boolean } | undefined)?.visible);
}
