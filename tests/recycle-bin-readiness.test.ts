import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

// Executes the real readiness/guard modules against a real PostgreSQL-compatible
// engine (PGlite, in-process) so the schema probe is verified by the database
// rather than by string matching. _db is injected explicitly; the application
// database module is never imported and no network/database server is used.

const DDL = `CREATE TABLE content_state (
  kind varchar(16) NOT NULL,
  content_id integer NOT NULL,
  deleted_at timestamp with time zone,
  is_anime_movie boolean NOT NULL DEFAULT false,
  CONSTRAINT content_state_kind_content_id_pk PRIMARY KEY (kind, content_id),
  CONSTRAINT content_state_kind_check CHECK (kind IN ('media', 'season', 'episode'))
)`;

class FixtureApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A pool adapter: same call shape as `pg.Pool`, one tracked session. */
function load(file: string, query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>) {
  const loaded = { exports: {} as Record<string, unknown> };
  const imports: Record<string, unknown> = {
    "server-only": {},
    "drizzle-orm": {},
    "@/db": { pool: { query: (sql: string) => query(sql) } },
    "./validation": { ApiError: FixtureApiError },
    "../validation": { ApiError: FixtureApiError },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module: loaded,
      exports: loaded.exports,
      Date,
      console: { error: () => {} },
      require: (name: string) => {
        assert.ok(name in imports, `Unexpected import ${name}`);
        return imports[name];
      },
    },
  );
  return loaded.exports as {
    lifecycleReady: () => Promise<boolean>;
    requireLifecycle: () => Promise<void>;
    requireNotificationsReady: () => Promise<void>;
    notificationsSetupMessage: string;
  };
}

async function engine() {
  const db = await PGlite.create();
  return {
    db,
    run: async (sql: string) => ({ rows: (await db.query<Record<string, unknown>>(sql)).rows }),
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
  };
}

/** Fresh module load so the ready/failure cache never hides a state change. */
const lifecycle = (db: Awaited<ReturnType<typeof engine>>) => load("src/lib/content-state.ts", db.run);

test("reproduction: the bin guard must not require the table to live in the public schema", async () => {
  const db = await engine();
  try {
    // An operator may install the additive migration on whichever schema the
    // application's search_path actually resolves, not necessarily `public`.
    await db.exec(`CREATE SCHEMA vault; SET search_path TO vault; ${DDL}`);
    await db.exec(`INSERT INTO content_state(kind,content_id,deleted_at) VALUES ('media',1,now())`);
    // The feature's own queries are unqualified, so they reach the installed table.
    assert.equal((await db.run("SELECT count(*)::int AS n FROM content_state")).rows[0].n, 1);
    // With the defect, the guard probed public and wrongly reported "not installed".
    assert.equal(await lifecycle(db).lifecycleReady(), true, "installed table must be detected through search_path");
    await lifecycle(db).requireLifecycle();
  } finally {
    await db.close();
  }
});

test("the bin guard never reports ready when runtime queries cannot resolve the table", async () => {
  const db = await engine();
  try {
    await db.exec(`CREATE SCHEMA vault; SET search_path TO vault; ${DDL}; SET search_path TO public`);
    // The table exists, but not where this session resolves names: every feature
    // query raises 42P01. The guard must fail closed instead of allowing a bin
    // request that would fail with a raw 500.
    assert.equal(await lifecycle(db).lifecycleReady(), false);
    await assert.rejects(lifecycle(db).requireLifecycle(), (error: unknown) => {
      assert.equal((error as FixtureApiError).status, 503);
      assert.match((error as FixtureApiError).message, /migration 0008/);
      return true;
    });
  } finally {
    await db.close();
  }
});

test("an absent or divergent content_state table is never treated as installed", async () => {
  const db = await engine();
  try {
    await db.exec("SET search_path TO public");
    assert.equal(await lifecycle(db).lifecycleReady(), false, "absent table");
    // Same relation name, incompatible shape: still a missing-schema condition.
    await db.exec(DDL);
    await db.exec("ALTER TABLE content_state DROP COLUMN is_anime_movie");
    assert.equal(await lifecycle(db).lifecycleReady(), false, "changed column");
    await db.exec("ALTER TABLE content_state ADD COLUMN is_anime_movie boolean NOT NULL DEFAULT false");
    assert.equal(await lifecycle(db).lifecycleReady(), true, "complete table");
    // A dropped (inactive) column must not count as present.
    await db.exec("ALTER TABLE content_state DROP COLUMN is_anime_movie");
    assert.equal(await lifecycle(db).lifecycleReady(), false, "dropped column");
  } finally {
    await db.close();
  }
});

test("the notification readiness guard resolves relations the same way its queries do", async () => {
  const db = await engine();
  try {
    await db.exec(`CREATE SCHEMA vault; SET search_path TO vault;
      CREATE TABLE subscribers (id varchar(64) PRIMARY KEY);
      CREATE TABLE anime_follows (watch_status text NOT NULL DEFAULT 'plan_to_watch', subscriber_id varchar(64) NOT NULL, media_id integer NOT NULL, PRIMARY KEY (subscriber_id, media_id));
      CREATE TABLE episode_publications (episode_id integer PRIMARY KEY);
      CREATE TABLE episode_notifications (id serial PRIMARY KEY);
      CREATE TABLE auth_rate_limits (key text PRIMARY KEY)`);
    const notifications = load("src/lib/notifications/readiness.ts", db.run);
    await notifications.requireNotificationsReady();
    await db.exec("ALTER TABLE anime_follows DROP COLUMN watch_status");
    await assert.rejects(load("src/lib/notifications/readiness.ts", db.run).requireNotificationsReady(), (error: unknown) => {
      assert.equal((error as FixtureApiError).status, 503);
      assert.equal((error as FixtureApiError).message, notifications.notificationsSetupMessage);
      return true;
    });
  } finally {
    await db.close();
  }
});

test("guards keep using the unqualified name its runtime queries use", () => {
  // Regression guard against reintroducing a schema-qualified probe that can
  // disagree with the unqualified feature queries in either direction.
  for (const file of ["src/lib/content-state.ts", "src/lib/notifications/readiness.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /to_regclass\('public\./, `${file} must resolve names like its queries`);
    assert.match(source, /to_regclass\('content_state'\)|to_regclass\('subscribers'\)/);
  }
});
