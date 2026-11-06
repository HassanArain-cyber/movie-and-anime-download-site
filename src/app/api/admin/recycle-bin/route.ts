import { NextResponse } from "next/server";
import { pool } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { lifecycleReady } from "@/lib/content-state";
import { contentKind, emptyBin, permanentlyDelete, restoreContent } from "@/lib/recycle-bin";
import { ApiError, errorResponse, positiveId, readJson } from "@/lib/validation";
export async function GET(req: Request) {
  const auth = await requireAdmin(req); if (auth !== true) return auth;
  try {
    if (!await lifecycleReady()) return NextResponse.json({ ready: false, items: [], total: 0 });
    const offset = Math.min(1000000, Math.floor(Math.max(0, Number(new URL(req.url).searchParams.get("offset")) || 0)));
    const result = await pool.query(`SELECT cs.kind,cs.content_id AS id,cs.deleted_at AS "deletedAt",COALESCE(m.type,pm.type) AS type,
      CASE cs.kind WHEN 'media' THEN m.title WHEN 'season' THEN pm.title || ' · Season ' || s.season_number ELSE pm.title || ' · Episode ' || e.episode_number || COALESCE(' · ' || e.title,'') END AS title,
      count(*) OVER()::int AS total
      FROM content_state cs LEFT JOIN media m ON cs.kind='media' AND m.id=cs.content_id
      LEFT JOIN seasons s ON cs.kind='season' AND s.id=cs.content_id LEFT JOIN episodes e ON cs.kind='episode' AND e.id=cs.content_id
      LEFT JOIN media pm ON pm.id=COALESCE(s.media_id,e.media_id)
      WHERE cs.deleted_at IS NOT NULL ORDER BY cs.deleted_at DESC,cs.kind,cs.content_id LIMIT 100 OFFSET $1`, [offset]);
    return NextResponse.json({ ready: true, items: result.rows, total: result.rows[0]?.total ?? 0 });
  } catch (error) { return errorResponse(error); }
}
export async function POST(req: Request) {
  const auth = await requireAdmin(req); if (auth !== true) return auth;
  try {
    const body = await readJson(req);
    if (body.action === "empty") {
      if (body.confirmation !== "EMPTY RECYCLE BIN") throw new ApiError(400, "Type EMPTY RECYCLE BIN to confirm permanent deletion.");
      await emptyBin();
    } else {
      const kind = contentKind(body.kind), id = positiveId(body.id);
      if (body.action === "restore") await restoreContent(kind, id);
      else if (body.action === "purge") {
        if (body.confirmation !== `DELETE PERMANENTLY ${kind}:${id}`) throw new ApiError(400, "Permanent deletion requires a separate typed confirmation.");
        await permanentlyDelete(kind, id);
      } else throw new ApiError(400, "Unknown action");
    }
    return NextResponse.json({ success: true, objectsRetained: true });
  } catch (error) { return errorResponse(error); }
}
