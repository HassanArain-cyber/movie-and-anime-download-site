import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class MockResponse {
  readonly ok: boolean;
  readonly type = "basic";
  readonly status: number;
  constructor(readonly body: string, options: { status?: number } = {}) { this.status = options.status ?? 200; this.ok = this.status === 200; }
  clone() { return new MockResponse(this.body, { status: this.status }); }
}
function worker() {
  const origin = "https://vault.example";
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const stores = new Map<string, Map<string, MockResponse>>();
  const requests: { url: string; cache?: string }[] = [];
  let offline = false, installed = false, claimed = false;
  const key = (input: string | { url: string }) => typeof input === "string" ? input : input.url;
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return { addAll: async (urls: string[]) => { for (const url of urls) store.set(url, new MockResponse(url)); }, match: async (input: string | { url: string }) => store.get(key(input)), put: async (input: string | { url: string }, response: MockResponse) => { store.set(key(input), response); } };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: string) => [...stores.values()].map((store) => store.get(input)).find(Boolean),
  };
  class MockRequest {
    url: string;
    constructor(input: { url: string }, readonly options: { cache: string }) { this.url = input.url; }
    get cache() { return this.options.cache; }
  }
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: { location: { origin }, addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => { handlers[type] = callback; }, skipWaiting: async () => { installed = true; }, clients: { claim: async () => { claimed = true; } } },
    URL, caches, Request: MockRequest, Response: MockResponse,
    fetch: async (request: { url: string; cache?: string }) => { requests.push({ url: request.url, cache: request.cache }); if (offline) throw Error("offline"); return new MockResponse("network"); },
  });
  const lifecycle = async (name: string) => {
    let wait: Promise<unknown> | undefined;
    handlers[name]({ waitUntil: (promise: Promise<unknown>) => { wait = promise; } });
    await wait;
  };
  const fetch = (path: string, mode = "cors", method = "GET") => {
    let response: Promise<MockResponse> | undefined;
    handlers.fetch({ request: { url: new URL(path, origin).href, method, mode }, respondWith: (promise: Promise<MockResponse>) => { response = promise; } });
    return response;
  };
  return { handlers, stores, requests, lifecycle, fetch, goOffline: () => { offline = true; }, installed: () => installed, claimed: () => claimed };
}
test("PWA install/activation keep offline/icon precache, update takeover and obsolete cache cleanup without push handlers", async () => {
  const w = worker();
  assert.deepEqual(Object.keys(w.handlers).sort(), ["activate", "fetch", "install"]);
  await w.lifecycle("install");
  assert.equal(w.installed(), true);
  for (const path of ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]) assert.ok(w.stores.get("vault-static-v1")?.has(path));
  w.stores.set("vault-static-obsolete", new Map()); w.stores.set("unrelated", new Map());
  await w.lifecycle("activate");
  assert.equal(w.claimed(), true);
  assert.equal(w.stores.has("vault-static-obsolete"), false);
  assert.equal(w.stores.has("unrelated"), true);
});
test("PWA caches immutable assets but excludes API/admin, external requests, mutations and other content", async () => {
  const w = worker(); await w.lifecycle("install");
  for (const path of ["/api/updates", "/api/follows", "/api/notifications", "/api/auth/login", "/admin", "/admin/media", "https://external.example/icons/a.png", "/uploads/private.jpg"]) assert.equal(w.fetch(path), undefined);
  assert.equal(w.fetch("/_next/static/test.js", "cors", "POST"), undefined);
  const first = await w.fetch("/_next/static/test.js");
  const second = await w.fetch("/_next/static/test.js");
  assert.ok(first); assert.equal(second?.body, "network");
  assert.equal(w.requests.length, 1, "second immutable asset request uses cache");
});
test("PWA navigation remains network-only/no-store and uses existing offline fallback", async () => {
  const w = worker(); await w.lifecycle("install");
  assert.equal((await w.fetch("/following", "navigate"))?.body, "network");
  assert.equal(w.requests[0].cache, "no-store");
  w.goOffline();
  assert.equal((await w.fetch("/following", "navigate"))?.body, "/offline.html");
  w.stores.get("vault-static-v1")?.delete("/offline.html");
  assert.equal((await w.fetch("/notifications", "navigate"))?.status, 503);
});
