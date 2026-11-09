import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as drizzle from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../src/db/schema";
const read = (file: string) => readFileSync(file, "utf8");
function fixture(ready: boolean) {
  const calls: string[] = [];
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const loaded = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  const imports: Record<string, unknown> = {
    "server-only": {}, "drizzle-orm": drizzle, "./validation": { ApiError },
    "@/db": { pool: { query: async (sql: string) => { calls.push(sql); return { rows: sql.includes("to_regclass") ? [{ ready }] : [{ active: false }] }; } } },
  };
  vm.runInNewContext(ts.transpileModule(read("src/lib/content-state.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: loaded, exports: loaded.exports, Date, require: (name: string) => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; } });
  return { api: loaded.exports, calls };
}
test("before 0008, reads do not reference missing tables and new lifecycle writes fail closed", async () => {
  const { api, calls } = fixture(false), dialect = new PgDialect();
  assert.equal(await api.lifecycleReady(), false);
  assert.equal(dialect.sqlToQuery(await api.activeContent("episode", 1) as drizzle.SQL).sql, "true");
  assert.equal(dialect.sqlToQuery(await api.animeMovieFlag(1) as drizzle.SQL).sql, "false");
  assert.equal(await api.assertActiveContent("media", 1), undefined);
  await assert.rejects(api.requireLifecycle(), (error: unknown) => (error as { status: number }).status === 503);
  assert.equal(calls.length, 1, "cache only probes relation availability; no content read or mutation");
  assert.match(calls[0], /SELECT to_regclass/);
});
test("active episode predicates check independent deletion plus both ancestors", async () => {
  const { api, calls } = fixture(true), dialect = new PgDialect();
  const result = dialect.sqlToQuery(await api.activeContent("episode", 13) as drizzle.SQL);
  for (const expression of ["deleted_at IS NOT NULL", "cs.kind='media'", "cs.kind='season'", "lifecycle_parent.season_id", "lifecycle_parent.media_id"]) assert.ok(result.sql.includes(expression));
  await assert.rejects(api.assertActiveContent("episode", 13), (error: unknown) => (error as { status: number }).status === 404);
  assert.ok(calls[1].includes("cs.kind='episode'"));
  const raw = await api.activeRaw("episode", "p.episode_id", true) as string;
  assert.ok(raw.includes("lifecycle_parent.id=p.episode_id"), "notification publication alias p must stay correlated to the outer query");
  assert.doesNotMatch(raw, /FROM episodes p\b|FROM seasons p\b/, "inner aliases must not shadow the publication alias");
});
test("0008 is strictly additive", async () => {
  // Asserted purely from historical snapshots, so later migrations cannot make
  // this historical check stale or tie it to the current schema.
  const previous = JSON.parse(read("drizzle/meta/0007_snapshot.json")), saved = JSON.parse(read("drizzle/meta/0008_snapshot.json"));
  const ddl = (await generateMigration(previous, saved)).join("\n");
  assert.match(ddl, /CREATE TABLE "content_state"/);
  assert.doesNotMatch(ddl, /\bALTER\b|\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i);
  const sql = read("drizzle/0008_recycle_bin.sql");
  assert.doesNotMatch(sql, /\bALTER\b|\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|wallpaper|r2_uploads/i);
  for (const [name, table] of Object.entries(previous.tables)) assert.deepEqual(saved.tables[name], table, `Existing ${name} is byte-structurally unchanged`);
});

test("the newest snapshot matches schema.ts, so the migration lineage is current", () => {
  const journal = JSON.parse(read("drizzle/meta/_journal.json")).entries;
  const latest = journal.at(-1).tag;
  const saved = JSON.parse(read(`drizzle/meta/${latest.slice(0, 4)}_snapshot.json`));
  const fresh = JSON.parse(JSON.stringify(generateDrizzleJson(schema)));
  for (const key of ["id", "prevId"]) { delete saved[key]; delete fresh[key]; }
  assert.deepEqual(fresh, saved, `${latest} snapshot must match src/db/schema.ts`);
});
