import test from "node:test";
import assert from "node:assert/strict";
import { assertSameOrigin, clientRateLimitKey, rateLimitSettings } from "../src/lib/request-security";
import { parseR2Endpoint } from "../src/lib/r2-endpoint";
import { ApiError, imageUrl, readJson } from "../src/lib/validation";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return run(); } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

function request(headers: Record<string, string> = {}, url = "http://127.0.0.1:3001/api/auth/login") {
  return new Request(url, { method: "POST", headers });
}

test("same-origin checks reject cross-site browser mutations but allow non-browser clients", () => {
  withEnv({ APP_ORIGIN: undefined }, () => {
    assert.doesNotThrow(() => assertSameOrigin(request()));
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: "http://127.0.0.1:3001", host: "127.0.0.1:3001" })));
    assert.throws(() => assertSameOrigin(request({ origin: "https://evil.example", host: "127.0.0.1:3001" })), ApiError);
    assert.throws(() => assertSameOrigin(request({ "sec-fetch-site": "cross-site" })), ApiError);
    assert.throws(() => assertSameOrigin(request({ origin: "null" })), ApiError);
  });
  withEnv({ APP_ORIGIN: "https://vault.example" }, () => {
    assert.doesNotThrow(() => assertSameOrigin(request({ origin: "https://vault.example" })));
    assert.throws(() => assertSameOrigin(request({ origin: "http://127.0.0.1:3001" })), ApiError);
  });
});

test("forwarded IP headers are ignored unless an operator explicitly trusts one single-IP header", () => {
  withEnv({ ADMIN_LOGIN_TRUSTED_IP_HEADER: undefined }, () => {
    assert.deepEqual(clientRateLimitKey(request({ "x-forwarded-for": "198.51.100.7" })), { key: "global", trusted: false });
  });
  withEnv({ ADMIN_LOGIN_TRUSTED_IP_HEADER: "x-real-ip" }, () => {
    assert.deepEqual(clientRateLimitKey(request({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" })), { key: "ip:198.51.100.7", trusted: true });
    assert.deepEqual(clientRateLimitKey(request({ "x-real-ip": "198.51.100.7, 203.0.113.9" })), { key: "global", trusted: false });
    assert.deepEqual(clientRateLimitKey(request({ "x-real-ip": "not-an-ip" })), { key: "global", trusted: false });
    assert.deepEqual(clientRateLimitKey(request({ "x-forwarded-for": "203.0.113.9" })), { key: "global", trusted: false });
  });
});

test("login limit settings are bounded and fail closed on invalid configuration", () => {
  withEnv({ ADMIN_LOGIN_WINDOW_SECONDS: undefined, ADMIN_LOGIN_MAX_ATTEMPTS: undefined, ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS: undefined }, () => {
    assert.deepEqual(rateLimitSettings(), { windowSeconds: 900, clientLimit: 5, globalLimit: 30 });
  });
  withEnv({ ADMIN_LOGIN_MAX_ATTEMPTS: "0" }, () => assert.throws(() => rateLimitSettings(), ApiError));
  withEnv({ ADMIN_LOGIN_WINDOW_SECONDS: "1.5" }, () => assert.throws(() => rateLimitSettings(), ApiError));
});

test("R2 endpoints require HTTPS except loopback tests and cannot contain credentials/path/query", () => {
  assert.equal(parseR2Endpoint("https://account.r2.cloudflarestorage.com").origin, "https://account.r2.cloudflarestorage.com");
  assert.equal(parseR2Endpoint("http://127.0.0.1:9000").origin, "http://127.0.0.1:9000");
  assert.throws(() => parseR2Endpoint("http://example.com"), /HTTPS/);
  assert.throws(() => parseR2Endpoint("https://user:pass@example.com"), /without credentials/);
  assert.throws(() => parseR2Endpoint("https://example.com/bucket"), /without credentials/);
  assert.throws(() => parseR2Endpoint("https://example.com?x=1"), /without credentials/);
});

test("JSON bodies require JSON content type and are bounded while streaming", async () => {
  await assert.rejects(() => readJson(new Request("http://local", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })), (error: unknown) => error instanceof ApiError && error.status === 415);
  const declared = new Request("http://local", { method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": "100" } });
  await assert.rejects(() => readJson(declared, 10), (error: unknown) => error instanceof ApiError && error.status === 413);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(64)));
      controller.close();
    },
  });
  await assert.rejects(() => readJson(new Request("http://local", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" } } as RequestInit), 16), (error: unknown) => error instanceof ApiError && error.status === 413);
  assert.deepEqual(await readJson(new Request("http://local", { method: "POST", body: '{"ok":true}', headers: { "content-type": "application/json; charset=utf-8" } })), { ok: true });
});

test("poster URLs preserve legacy/R2/public images but block scripts and private-network optimizer targets", () => {
  assert.equal(imageUrl("/uploads/images/legacy.jpg"), "/uploads/images/legacy.jpg");
  assert.equal(imageUrl("/api/image?upload=123e4567-e89b-42d3-a456-426614174000"), "/api/image?upload=123e4567-e89b-42d3-a456-426614174000");
  assert.equal(imageUrl("https://images.example/poster.jpg"), "https://images.example/poster.jpg");
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "http://127.0.0.1/x", "http://169.254.169.254/latest", "http://10.0.0.1/x", "http://localhost/x", "http://[::1]/x", "https://user:pass@example.com/x"]) {
    assert.throws(() => imageUrl(value), ApiError);
  }
});
