import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file: string, imports: Record<string, unknown>) {
  const loaded = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: loaded, exports: loaded.exports, Request, Response, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; } });
  return loaded.exports;
}
for (const [kind, table] of [["comments", "comments"], ["requests", "contact_requests"]] as const) {
  test(`${kind}: collection delete is one unfiltered atomic statement without page limits`, async () => {
    const calls: string[] = [];
    const api = load("src/lib/admin-delete-all.ts", { "server-only": {}, "@/db": { pool: { query: async (sql: string) => { calls.push(sql); return { rows: [{ deleted: 1501 }] }; } } } });
    assert.equal(await api.deleteAllAdminRecords(kind), 1501); assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(`DELETE FROM ${table} RETURNING id`));
    assert.doesNotMatch(calls[0], /LIMIT|OFFSET|TRUNCATE|WHERE|DELETE FROM (media|episodes|r2_uploads|site_settings)/i);
  });
  test(`${kind}: auth, explicit confirmation, full counts and database error response`, async () => {
    let status = 401, fail = false; const calls: unknown[] = [];
    class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
    const route = load(kind === "comments" ? "src/app/api/admin/comments/route.ts" : "src/app/api/contact/requests/route.ts", {
      "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
      "drizzle-orm": {}, "@/db": {}, "@/db/schema": {},
      "@/lib/auth": { requireAdmin: async () => status === 200 ? true : Response.json({ error: "Denied" }, { status }) },
      "@/lib/validation": { ApiError, readJson: (req: Request) => req.json(), errorResponse: (error: Error & { status?: number }) => Response.json({ error: error.status ? error.message : "Internal error" }, { status: error.status || 500 }) },
      "@/lib/admin-delete-all": { deleteAllAdminRecords: async (target: unknown) => { calls.push(target); if (fail) throw new Error("Database unavailable"); return 1501; } },
    });
    const request = (body: unknown) => new Request("https://fixture.test/api?limit=1&offset=200&status=pending", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    for (const denied of [401, 403]) { status = denied; assert.equal((await route.DELETE(request({ confirm: true })) as Response).status, denied); }
    assert.equal(calls.length, 0);
    status = 200;
    for (const body of [{}, { confirm: false }, { confirm: "true" }]) assert.equal((await route.DELETE(request(body)) as Response).status, 400);
    assert.equal(calls.length, 0);
    const response = await route.DELETE(request({ confirm: true })) as Response;
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true, deleted: 1501 });
    assert.deepEqual(calls, [kind]);
    fail = true; assert.equal((await route.DELETE(request({ confirm: true })) as Response).status, 500);
  });
}
