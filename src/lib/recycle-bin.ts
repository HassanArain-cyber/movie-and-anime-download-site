import "server-only";
import type { PoolClient } from "pg";
import { pool } from "@/db";
import { ApiError } from "./validation";
import { requireLifecycle, type ContentKind } from "./content-state";
export function contentKind(value: unknown): ContentKind {
  if (value !== "media" && value !== "season" && value !== "episode") throw new ApiError(400, "Invalid content kind");
  return value;
}
const tables = { media: "media", season: "seasons", episode: "episodes" } as const;
async function transaction<T>(action: (client: PoolClient) => Promise<T>) {
  await requireLifecycle();
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(728401)"); const result = await action(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function mark(client: PoolClient, kind: ContentKind, id: number) {
  const found = await client.query(`SELECT id FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`, [id]);
  if (!found.rowCount) throw new ApiError(404, "Content not found");
  await client.query("INSERT INTO content_state(kind,content_id,deleted_at) VALUES ($1,$2,now()) ON CONFLICT(kind,content_id) DO UPDATE SET deleted_at=COALESCE(content_state.deleted_at,EXCLUDED.deleted_at)", [kind, id]);
}
export async function moveToBin(kind: ContentKind, id: number) { await transaction((client) => mark(client, kind, id)); }
export async function moveEpisodes(seasonId: number, ids: number[] | null) {
  return transaction(async (client) => {
    const season = await client.query("SELECT id FROM seasons WHERE id=$1 FOR UPDATE", [seasonId]);
    if (!season.rowCount) throw new ApiError(404, "Season not found");
    const rows = await client.query("SELECT id FROM episodes WHERE season_id=$1 AND ($2::int[] IS NULL OR id=ANY($2)) ORDER BY id FOR UPDATE", [seasonId, ids]);
    if (ids && rows.rowCount !== new Set(ids).size) throw new ApiError(400, "Selected episodes must all belong to this season. Nothing was moved.");
    if (rows.rowCount) await client.query("INSERT INTO content_state(kind,content_id,deleted_at) SELECT 'episode',id,now() FROM unnest($1::int[]) AS selected(id) ON CONFLICT(kind,content_id) DO UPDATE SET deleted_at=COALESCE(content_state.deleted_at,EXCLUDED.deleted_at)", [rows.rows.map((row) => row.id)]);
    return rows.rowCount;
  });
}
export async function restoreContent(kind: ContentKind, id: number) {
  return transaction(async (client) => {
    const found = await client.query(`SELECT * FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`, [id]);
    if (!found.rowCount) throw new ApiError(404, "Content not found");
    const row = found.rows[0];
    const parent = await client.query("SELECT 1 FROM content_state WHERE deleted_at IS NOT NULL AND ((kind='media' AND content_id=$1) OR (kind='season' AND content_id=$2))", [kind === "media" ? null : row.media_id, kind === "episode" ? row.season_id : null]);
    if (parent.rowCount) throw new ApiError(409, "Restore the parent title/season first. Nothing was changed.");
    await client.query("UPDATE content_state SET deleted_at=NULL WHERE kind=$1 AND content_id=$2", [kind, id]);
  });
}
async function purge(client: PoolClient, kind: ContentKind, ids: number[]) {
  if (!ids.length) return;
  const marker = await client.query("SELECT content_id FROM content_state WHERE kind=$1 AND content_id=ANY($2::int[]) AND deleted_at IS NOT NULL FOR UPDATE", [kind, ids]);
  if (marker.rowCount !== ids.length) throw new ApiError(409, "Only items already in the Recycle Bin can be permanently deleted.");
  // Deliberate database purge only. Physical R2 and independent upload history
  // are NEVER removed. Capture descendants before FK cascades remove records.
  const seasons = kind === "media" ? (await client.query("SELECT id FROM seasons WHERE media_id=ANY($1::int[])", [ids])).rows.map((row) => row.id) : kind === "season" ? ids : [];
  const episodes = kind === "episode" ? ids : (await client.query(`SELECT id FROM episodes WHERE ${kind === "media" ? "media_id" : "season_id"}=ANY($1::int[])`, [ids])).rows.map((row) => row.id);
  await client.query(`DELETE FROM ${tables[kind]} WHERE id=ANY($1::int[])`, [ids]);
  await client.query("DELETE FROM content_state WHERE (kind=$1 AND content_id=ANY($2::int[])) OR (kind='season' AND content_id=ANY($3::int[])) OR (kind='episode' AND content_id=ANY($4::int[]))", [kind, ids, seasons, episodes]);
}
export async function permanentlyDelete(kind: ContentKind, id: number) { await transaction((client) => purge(client, kind, [id])); }
export async function emptyBin() {
  await transaction(async (client) => {
    // Parent-first, set-based operations avoid one round trip per episode and
    // preserve the all-or-nothing transaction for large (>500) seasons.
    for (const kind of ["media", "season", "episode"] as const) {
      const rows = await client.query("SELECT content_id FROM content_state WHERE kind=$1 AND deleted_at IS NOT NULL ORDER BY content_id", [kind]);
      await purge(client, kind, rows.rows.map((row) => row.content_id));
    }
  });
}
