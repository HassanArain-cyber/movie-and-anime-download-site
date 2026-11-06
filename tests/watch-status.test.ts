import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../src/db/schema";
import { WATCH_STATUSES, isWatchStatus, isFollowableContentType } from "../src/lib/watch-status";

const read = (path: string) => readFileSync(path, "utf8");
test("exactly five watch statuses are accepted, with the approved labels", () => {
  assert.deepEqual(WATCH_STATUSES.map((s) => s.label), ["Plan to Watch", "Watching", "Continue", "On-Hold", "Watched"]);
  for (const { value } of WATCH_STATUSES) assert.equal(isWatchStatus(value), true);
  for (const value of [undefined, null, 1, {}, [], "", "Watching", "completed", "watching ", ["watching", "watched"]]) assert.equal(isWatchStatus(value), false);
});
test("unapplied 0007 SQL/snapshot agree with generated schema and unqualified status constraint", async () => {
  const sql = read("drizzle/0007_anime_notifications.sql");
  const snapshot = JSON.parse(read("drizzle/meta/0007_snapshot.json"));
  const names = ["anime_follows", "episode_notifications", "episode_publications", "subscribers"];
  assert.deepEqual([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort(), names);
  assert.deepEqual(Object.keys(snapshot.tables).filter((name) => !JSON.parse(read("drizzle/meta/0006_snapshot.json")).tables[name]).map((name) => name.replace("public.", "")).sort(), names);
  const follows = snapshot.tables["public.anime_follows"];
  assert.equal(follows.columns.watch_status.notNull, true);
  assert.equal(follows.columns.watch_status.default, "'plan_to_watch'");
  assert.match(sql, /"watch_status" text DEFAULT 'plan_to_watch' NOT NULL/);
  assert.ok(sql.includes(follows.checkConstraints.anime_follows_watch_status_check.value));
  const expression = `"watch_status" IN ('plan_to_watch', 'watching', 'continue', 'on_hold', 'watched')`;
  assert.equal(follows.checkConstraints.anime_follows_watch_status_check.value, expression);
  // Pure in-memory generation only: no db/index import, config, CLI, writes or DB.
  const fresh = generateDrizzleJson(schema);
  const normalized = JSON.parse(JSON.stringify(fresh));
  const saved = JSON.parse(JSON.stringify(snapshot));
  for (const key of ["id", "prevId"]) { delete normalized[key]; delete saved[key]; }
  assert.deepEqual(normalized, saved, "entire serialized snapshot must match schema.ts, excluding lineage IDs");
  const ddl = await generateMigration(JSON.parse(read("drizzle/meta/0006_snapshot.json")), fresh);
  assert.ok(ddl.join("\n").includes(`CONSTRAINT "anime_follows_watch_status_check" CHECK (${expression})`), "Drizzle-generated DDL must use the same unqualified CHECK expression");
  assert.deepEqual(follows.compositePrimaryKeys.anime_follows_subscriber_id_media_id_pk.columns, ["subscriber_id", "media_id"]);
  for (const { value } of WATCH_STATUSES) assert.ok(sql.includes(`'${value}'`));
  assert.doesNotMatch(sql, /push_subscriptions|push_deliveries|\bDROP\b|\bTRUNCATE\b|DELETE FROM/);
  assert.equal(JSON.parse(read("drizzle/meta/_journal.json")).entries.length, 8);
});
test("build stays migration-free and episode notifications are in-site only", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts["db:migrate"], "drizzle-kit migrate");
  assert.equal(pkg.dependencies["web-push"], undefined);
  for (const path of ["src/app/api/push-subscription", "src/components/PushPreferences.tsx"]) assert.equal(existsSync(path), false);
});

// Exercise the real route handler source with injected in-memory imports. This
// does not import @/db, pg, the live session module, or any executable entrypoint.
function routeFixture(contentType = "anime") {
  const follows = new Map<string, { status: string; createdAt: number }>();
  const calls: { sql: string; args: unknown[] }[] = [];
  let identity = "alice";
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const query = async (sql: string, args: unknown[] = []) => {
    calls.push({ sql, args });
    const key = `${args[0]}:${args[1]}`;
    if (sql.startsWith("SELECT type")) return { rowCount: 1, rows: [{ type: contentType }] };
    if (sql.startsWith("SELECT count")) return { rows: [{ count: follows.size }] };
    if (sql.startsWith("SELECT 1 FROM anime_follows")) return { rowCount: follows.has(key) ? 1 : 0 };
    if (sql.startsWith("INSERT INTO anime_follows")) { if (!follows.has(key)) follows.set(key, { status: "plan_to_watch", createdAt: 123 }); }
    if (sql.startsWith("UPDATE anime_follows")) {
      const row = follows.get(key);
      if (row) row.status = args[2] as string;
      return { rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("DELETE FROM anime_follows")) follows.delete(key);
    return { rows: [], rowCount: 1 };
  };
  const imports: Record<string, unknown> = {
    "@/db": { pool: { query, connect: async () => ({ query, release: () => {} }) } },
    "@/lib/validation": { ApiError, readJson: async (req: { body: unknown }) => req.body, positiveId: (id: number) => { if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "Invalid id"); return id; } },
    "@/lib/watch-status": { isWatchStatus, isFollowableContentType },
    "@/lib/notifications/session": { subscriber: async () => ({ id: identity }), notificationRateLimit: async () => {}, privateJson: (data: unknown) => ({ status: 200, data }), notificationError: (error: ApiError) => ({ status: error.status || 500 }) },
  };
  type Handler = (req: { body: unknown }) => Promise<{ status: number }>;
  const exports: Record<string, Handler> = {};
  const code = ts.transpileModule(read("src/app/api/follows/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => { if (!(id in imports)) throw Error(`Unexpected dependency ${id}`); return imports[id]; } });
  return { follows, calls, handlers: exports, as: (id: string) => { identity = id; } };
}
test("Follow/PATCH/Unfollow routes default status, preserve timestamps, validate and isolate subscribers", async () => {
  const f = routeFixture(), body = { mediaId: 17 };
  assert.equal((await f.handlers.POST({ body })).status, 200);
  assert.deepEqual(f.follows.get("alice:17"), { status: "plan_to_watch", createdAt: 123 });
  for (const { value } of WATCH_STATUSES) {
    assert.equal((await f.handlers.PATCH({ body: { ...body, watchStatus: value } })).status, 200);
    assert.equal(f.follows.get("alice:17")?.status, value);
    assert.equal(f.follows.get("alice:17")?.createdAt, 123);
  }
  assert.equal((await f.handlers.POST({ body })).status, 200);
  assert.equal(f.follows.get("alice:17")?.status, "watched", "repeated follow must not reset status");
  for (const value of [undefined, null, "invalid", ["watched"]]) assert.equal((await f.handlers.PATCH({ body: { ...body, watchStatus: value } })).status, 400);
  f.as("bob");
  assert.equal((await f.handlers.PATCH({ body: { ...body, watchStatus: "watching" } })).status, 404);
  assert.equal(f.follows.get("alice:17")?.status, "watched");
  f.as("alice");
  assert.equal((await f.handlers.DELETE({ body })).status, 200);
  assert.equal(f.follows.size, 0);
  assert.ok(f.calls.filter((call) => call.sql.startsWith("UPDATE anime_follows")).every((call) => call.sql.includes("subscriber_id=$1 AND media_id=$2") && !call.sql.includes("created_at=")));
  assert.ok(f.calls.every((call) => !call.sql.includes("episode_notifications") && !call.sql.includes("push_")));
});


test("movies, anime and series share manual follows/statuses without adding movie episode alerts", async () => {
  for (const type of ["movie", "anime", "series"]) {
    assert.equal(isFollowableContentType(type), true);
    const f = routeFixture(type), body = { mediaId: 21 };
    assert.equal((await f.handlers.POST({ body })).status, 200, `${type} can be followed`);
    assert.equal(f.follows.get("alice:21")?.status, "plan_to_watch");
    for (const { value } of WATCH_STATUSES) {
      assert.equal((await f.handlers.PATCH({ body: { ...body, watchStatus: value } })).status, 200);
      assert.deepEqual(f.follows.get("alice:21"), { status: value, createdAt: 123 });
    }
    assert.equal((await f.handlers.POST({ body })).status, 200);
    assert.equal(f.follows.get("alice:21")?.status, "watched");
    f.as("bob");
    assert.equal((await f.handlers.PATCH({ body: { ...body, watchStatus: "watching" } })).status, 404);
    f.as("alice");
    assert.equal((await f.handlers.PATCH({ body: { ...body, watchStatus: "invalid" } })).status, 400);
    assert.equal((await f.handlers.DELETE({ body })).status, 200);
    assert.equal(f.follows.size, 0);
    assert.ok(f.calls.every(({ sql }) => !sql.includes("episode_notifications") && !sql.includes("episode_publications")));
  }
  for (const type of ["", "Movie", "unknown"]) {
    assert.equal(isFollowableContentType(type), false);
    const f = routeFixture(type);
    assert.equal((await f.handlers.POST({ body: { mediaId: 21 } })).status, 400);
    assert.equal(f.follows.size, 0);
  }
  for (const value of [null, undefined, 1, {}, []]) assert.equal(isFollowableContentType(value), false);
  assert.match(read("src/app/[type]/[slug]/page.tsx"), /<FollowButton mediaId=\{item.id\} mediaType=\{item.type\}/);
  assert.match(read("drizzle/0007_anime_notifications.sql"), /m.type IN \('anime', 'series'\)/);
});


test("movie follows reuse the shared 500-title cap without blocking edits or unfollow", async () => {
  const f = routeFixture("movie");
  for (let id = 1; id <= 500; id++) f.follows.set(`alice:${id}`, { status: "plan_to_watch", createdAt: 123 });
  assert.equal((await f.handlers.POST({ body: { mediaId: 501 } })).status, 409);
  assert.equal(f.follows.size, 500);
  assert.equal((await f.handlers.POST({ body: { mediaId: 1 } })).status, 200);
  assert.equal((await f.handlers.PATCH({ body: { mediaId: 1, watchStatus: "continue" } })).status, 200);
  assert.equal((await f.handlers.DELETE({ body: { mediaId: 1 } })).status, 200);
  assert.equal((await f.handlers.POST({ body: { mediaId: 501 } })).status, 200);
  assert.equal(f.follows.size, 500);
});
