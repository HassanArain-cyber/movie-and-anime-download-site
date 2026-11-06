import "server-only";
import { sql, type SQLWrapper } from "drizzle-orm";
import { pool } from "@/db";
import { ApiError } from "./validation";
export type ContentKind = "media" | "season" | "episode";
let readiness: { until: number; ready: boolean } | undefined;
/** Before an operator installs 0008, existing reads work and new writes fail closed. */
export async function lifecycleReady() {
  if (readiness && readiness.until > Date.now()) return readiness.ready;
  const result = await pool.query("SELECT to_regclass('public.content_state') IS NOT NULL AS ready");
  const ready = result.rows[0]?.ready === true;
  readiness = { ready, until: Date.now() + (ready ? 60000 : 1000) };
  return ready;
}
export async function requireLifecycle() {
  if (!await lifecycleReady()) throw new ApiError(503, "Recycle Bin / anime-movie classification requires additive migration 0008. Ask the operator to install it on Preview; no deletion was performed.");
}
// Only trusted, source-code SQL expressions may be passed to activeRaw.
export function activeRaw(kind: ContentKind, id: string, ready: boolean): string {
  if (!ready) return "TRUE";
  const own = `NOT EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind='${kind}' AND cs.content_id=${id} AND cs.deleted_at IS NOT NULL)`;
  if (kind === "media") return own;
  const media = kind === "season" ? `(SELECT p.media_id FROM seasons p WHERE p.id=${id})` : `(SELECT p.media_id FROM episodes p WHERE p.id=${id})`;
  const parent = `NOT EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind='media' AND cs.content_id=${media} AND cs.deleted_at IS NOT NULL)`;
  const season = kind === "episode" ? ` AND NOT EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind='season' AND cs.content_id=(SELECT p.season_id FROM episodes p WHERE p.id=${id}) AND cs.deleted_at IS NOT NULL)` : "";
  return `(${own} AND ${parent}${season})`;
}
export async function activeContent(kind: ContentKind, id: SQLWrapper | number) {
  if (!await lifecycleReady()) return sql`true`;
  const own = sql`NOT EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind=${kind} AND cs.content_id=${id} AND cs.deleted_at IS NOT NULL)`;
  if (kind === "media") return own;
  const parentMedia = kind === "season" ? sql`(SELECT p.media_id FROM seasons p WHERE p.id=${id})` : sql`(SELECT p.media_id FROM episodes p WHERE p.id=${id})`;
  const media = sql`NOT EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind='media' AND cs.content_id=${parentMedia} AND cs.deleted_at IS NOT NULL)`;
  return kind === "season" ? sql`(${own} AND ${media})` : sql`(${own} AND ${media} AND NOT EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind='season' AND cs.content_id=(SELECT p.season_id FROM episodes p WHERE p.id=${id}) AND cs.deleted_at IS NOT NULL))`;
}
export async function assertActiveContent(kind: ContentKind, id: number) {
  if (!await lifecycleReady()) return;
  const row = await pool.query(`SELECT ${activeRaw(kind, "$1", true)} AS active`, [id]);
  if (!row.rows[0]?.active) throw new ApiError(404, "Content is in the Recycle Bin. Restore its parents first.");
}
export async function animeMovieFlag(id: SQLWrapper | number) {
  return await lifecycleReady() ? sql<boolean>`EXISTS (SELECT 1 FROM content_state cs WHERE cs.kind='media' AND cs.content_id=${id} AND cs.is_anime_movie)` : sql<boolean>`false`;
}
