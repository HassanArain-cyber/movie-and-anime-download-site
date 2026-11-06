import "server-only";
import { pool } from "@/db";
// Fixed statements only: no request-supplied table, filter, page or SQL fragment.
// One atomic statement deletes the complete collection, not a visible API page.
const statements = {
  comments: "WITH deleted AS (DELETE FROM comments RETURNING id) SELECT count(*)::int AS deleted FROM deleted",
  requests: "WITH deleted AS (DELETE FROM contact_requests RETURNING id) SELECT count(*)::int AS deleted FROM deleted",
} as const;
export async function deleteAllAdminRecords(kind: keyof typeof statements): Promise<number> {
  const result = await pool.query(statements[kind]);
  return result.rows[0].deleted;
}
