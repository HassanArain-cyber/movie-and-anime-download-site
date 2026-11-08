import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { WATCH_STATUSES } from "../src/lib/watch-status";

// Execute real source with explicit in-memory dependencies; never import @/db.
function load(file: string, imports: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const loaded = { exports: {} as Record<string, (...args: never[]) => unknown> };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: loaded, exports: loaded.exports, ...extra, require: (name: string) => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return loaded.exports;
}
function button(data: unknown, error = "") {
  const component = load("src/components/FollowButton.tsx", {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}] },
    "react/jsx-runtime": jsx, "@/lib/watch-status": { WATCH_STATUSES },
    "./UpdatesProvider": { useUpdates: () => ({ data, error }) },
  }).default as unknown as React.ComponentType<{ mediaId: number; mediaType: string }>;
  return renderToStaticMarkup(React.createElement(component, { mediaId: 7, mediaType: "anime" }));
}

test("reproduction: an updates outage must not leave Follow permanently labelled Loading", () => {
  const html = button(null, "Notifications are temporarily unavailable. Please try again.");
  assert.match(html, /\+ Follow/);
  assert.doesNotMatch(html, /Loading…/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Retry/);
});
test("successful bootstrap renders Follow and preserves all five statuses for a followed anime", () => {
  assert.match(button({ following: [] }), /\+ Follow/);
  const html = button({ following: [{ id: 7, type: "anime", watchStatus: "watching" }] });
  assert.match(html, /Unfollow/);
  assert.match(html, /aria-pressed="true"/);
  for (const status of WATCH_STATUSES) assert.ok(html.includes(status.label));
});

test("0008 absence is explicitly supported for notification reads; migration status is not inferred from Git", () => {
  const source = readFileSync("src/lib/content-state.ts", "utf8");
  assert.match(source, /if \(!ready\) return "TRUE"/);
  const migration = readFileSync("drizzle/0007_anime_notifications.sql", "utf8");
  for (const table of ["subscribers", "anime_follows", "episode_publications", "episode_notifications"]) {
    assert.ok(migration.includes(`CREATE TABLE "${table}"`));
  }
  assert.match(readFileSync("drizzle/0008_recycle_bin.sql", "utf8"), /CREATE TABLE "content_state"/);
});


class FixtureApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function sessionFixture() {
  const logs: unknown[][] = [];
  const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), init);
  const loaded = load("src/lib/notifications/session.ts", {
    "server-only": {}, "node:crypto": {}, "next/server": { NextResponse: { json } },
    "@/db": {}, "../request-security": {}, "../validation": { ApiError: FixtureApiError, errorResponse: (error: FixtureApiError) => json({ error: error.message }, { status: error.status }) },
    "./readiness": { notificationsSetupMessage: "Following and notifications are not set up yet. Please try again later." },
  }, { console: { error: (...args: unknown[]) => logs.push(args) } });
  return { logs, error: loaded.notificationError as unknown as (error: unknown) => Response };
}
test("reproduction: a missing 0007 relation produces a safe 503, never successful empty follows", async () => {
  const f = sessionFixture();
  const response = f.error({ code: "42P01", message: "private database URL and row details" });
  assert.equal(response.status, 503);
  assert.match(response.headers.get("Cache-Control")!, /private, no-store/);
  const body = await response.text();
  assert.ok(!body.includes("private database"));
  assert.ok(!body.includes('"following":[]'));
  assert.deepEqual(f.logs, [["Notification request unavailable", "42P01"]]);
});

test("schema errors are distinguishable from connection outages without leaking private errors", async () => {
  const f = sessionFixture();
  for (const error of [{ code: "42P01" }, { cause: { code: "42703", message: "secret" } }]) {
    const response = f.error(error);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /not set up yet/);
  }
  const response = f.error({ code: "ECONNREFUSED", message: "secret" });
  assert.match(await response.text(), /temporarily unavailable/);
  assert.ok(!JSON.stringify(f.logs).includes("secret"));
  const forbidden = f.error(new FixtureApiError(403, "Cross-site requests are not allowed"));
  assert.equal(forbidden.status, 403);
  assert.match(await forbidden.text(), /Cross-site/);
});

function updatesFixture(ready: boolean, lifecycle = false) {
  const sql: string[] = [], logs: unknown[][] = [];
  let currentReady = ready, afterCalls = 0, fanoutCalls = 0;
  const pool = { query: async (text: string) => {
    sql.push(text);
    if (text.includes("AS ready")) return { rows: [{ ready: currentReady }] };
    if (text.includes("RETURNING attempts")) return { rows: [{ attempts: 1 }] };
    if (text.startsWith("SELECT count")) return { rows: [{ count: 0 }] };
    return { rows: [], rowCount: 1 };
  } };
  const validation = { ApiError: FixtureApiError, errorResponse: (error: FixtureApiError) => new Response(JSON.stringify({ error: error.message }), { status: error.status }) };
  const console = { error: (...args: unknown[]) => logs.push(args) };
  const readiness = load("src/lib/notifications/readiness.ts", {
    "server-only": {}, "@/db": { pool }, "../validation": validation,
  }, { console });
  const session = load("src/lib/notifications/session.ts", {
    "server-only": {}, "node:crypto": require("node:crypto"),
    "next/server": { NextResponse: { json: (data: unknown, init: ResponseInit = {}) => Object.assign(new Response(JSON.stringify(data), init), { cookies: { set: () => {} } }) } },
    "@/db": { pool }, "../request-security": { assertSameOrigin: () => {}, clientRateLimitKey: () => ({ trusted: false }) },
    "../validation": validation, "./readiness": readiness,
  }, { console, process: { env: { ADMIN_PASSWORD: "synthetic-test-only-password" } } });
  const content = { lifecycleReady: async () => lifecycle, activeRaw: (_kind: string, _id: string, available: boolean) => available ? "NOT EXISTS (SELECT 1 FROM content_state WHERE deleted_at IS NOT NULL)" : "TRUE" };
  const inbox = load("src/lib/notifications/inbox.ts", { "server-only": {}, "@/db": { pool }, "../content-state": content });
  const route = load("src/app/api/updates/route.ts", {
    "@/lib/content-state": content, "next/server": { after: () => { afterCalls++; } }, "@/db": { pool },
    "@/lib/notifications/session": session, "@/lib/notifications/inbox": inbox,
    "@/lib/notifications/worker": { safelyProcessNotifications: () => {} },
  });
  const worker = load("src/lib/notifications/worker.ts", {
    "server-only": {}, "@/db": { pool }, "./readiness": readiness,
    "./fanout": { drainFanout: async () => { fanoutCalls++; return 0; } },
  }, { console, Date });
  return {
    sql, logs, setReady: (value: boolean) => { currentReady = value; },
    get: () => (route.GET as unknown as (req: Request) => Promise<Response>)(new Request("https://fixture.invalid/api/updates")),
    subscriber: session.subscriber as unknown as (req: Request, create?: boolean) => Promise<unknown>,
    process: worker.processNotifications as unknown as () => Promise<unknown>,
    afterCalls: () => afterCalls, fanoutCalls: () => fanoutCalls,
  };
}

test("real updates handler fails closed before subscriber/rate writes when 0007 is absent, then recovers on Retry", async () => {
  const f = updatesFixture(false);
  const response = await f.get();
  assert.equal(response.status, 503);
  assert.match(await response.text(), /not set up yet/);
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(f.sql.length, 1);
  assert.doesNotMatch(f.sql[0], /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.equal(f.afterCalls(), 0);
  f.setReady(true);
  const recovered = await f.get();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { following: [], unread: 0, notifications: [], hasMore: false });
  assert.equal(f.afterCalls(), 1);
  assert.ok(f.sql.some((sql) => sql.startsWith("INSERT INTO subscribers")));
});

test("with 0007 present and 0008 absent, real updates and inbox queries omit content_state", async () => {
  const f = updatesFixture(true, false);
  assert.equal((await f.get()).status, 200);
  assert.ok(f.sql.some((text) => text.includes("FROM anime_follows")));
  assert.ok(f.sql.some((text) => text.includes("FROM episode_notifications")));
  assert.ok(f.sql.every((text) => !text.includes("content_state")));
});

test("0008 present preserves lifecycle filtering in updates and inbox", async () => {
  const f = updatesFixture(true, true);
  assert.equal((await f.get()).status, 200);
  assert.ok(f.sql.filter((text) => text.includes("content_state")).length >= 3);
});

test("shared subscriber guard protects follows/history writes; direct worker does not drain without schema", async () => {
  const f = updatesFixture(false);
  await assert.rejects(f.subscriber(new Request("https://fixture.invalid/api/follows")), (error: unknown) => (error as FixtureApiError).status === 503);
  await assert.rejects(f.process(), (error: unknown) => (error as FixtureApiError).status === 503);
  assert.equal(f.fanoutCalls(), 0);
  assert.ok(f.sql.every((text) => !/\bINSERT\b|\bUPDATE\b|\bDELETE\b/.test(text)));
});

test("bell and Following share the actual outage, never show an empty-success state", () => {
  const error = "Following and notifications are not set up yet. Please try again later.";
  const context = { data: null, error, refresh: async () => {} };
  const react = { ...React, useState: (initial: unknown) => [initial, () => {}], useRef: () => ({ current: null }), useEffect: () => {} };
  const link = ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children);
  const imports = {
    react, "react/jsx-runtime": jsx, "next/link": { default: link, __esModule: true },
    "./UpdatesProvider": { useUpdates: () => context },
    "./PosterImage": { default: () => null, __esModule: true },
    "./FollowButton": { default: () => null, __esModule: true },
    "@/lib/watch-status": { WATCH_STATUSES },
  };
  for (const file of ["src/components/NotificationBell.tsx", "src/components/FollowingPage.tsx"]) {
    const component = load(file, imports).default as unknown as React.ComponentType;
    const html = renderToStaticMarkup(React.createElement(component));
    assert.ok(html.includes(error));
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /No episode alerts yet|You are not following anything yet/);
  }
});

test("real UpdatesProvider Retry recovers shared state after failed initialization", async () => {
  const states: unknown[] = [];
  let cursor = 0, effect: (() => void) | undefined, requests = 0;
  const recovered = { following: [], unread: 0, notifications: [], hasMore: false };
  const source = load("src/components/UpdatesProvider.tsx", {
    react: { ...React,
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value: unknown) => { states[index] = value; }];
      },
      useRef: () => ({ current: null }), useCallback: (fn: unknown) => fn,
      useEffect: (fn: () => void) => { effect = fn; },
    }, "react/jsx-runtime": jsx,
  }, {
    fetch: async () => {
      requests++;
      return { ok: requests > 1, json: async () => requests === 1 ? { error: "Notifications are temporarily unavailable. Please try again." } : recovered };
    },
    document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    setInterval: () => 1, clearInterval: () => {},
  });
  const provider = source.default as unknown as (props: { children: null }) => { props: { value: { data: unknown; error: string; refresh: () => Promise<void> } } };
  const render = () => { cursor = 0; return provider({ children: null }).props.value; };
  render();
  effect!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render().data, null);
  assert.match(render().error, /temporarily unavailable/);
  await render().refresh();
  assert.equal(render().error, "");
  assert.equal(render().data, recovered);
  assert.equal(requests, 2);
});
