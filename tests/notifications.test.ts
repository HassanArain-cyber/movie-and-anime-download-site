import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, createPublicKey, verify } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import webpush from "web-push";
import { validateSubscription, retryDelay, pushFailure } from "../src/lib/notifications/validation";
import { encryptSubscription, decryptSubscription, pushConfigured } from "../src/lib/notifications/subscription-crypto";
const pair = createECDH("prime256v1"); pair.generateKeys();
const auth = randomBytes(16);
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test-opaque-token", keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };

test("subscriptions accept real P-256 browser keys and only known HTTPS push services", () => {
  assert.deepEqual(validateSubscription(subscription), subscription);
  for (const host of ["updates.push.services.mozilla.com/wpush/v2/token", "web.push.apple.com/token", "wns2-test.notify.windows.com/token"]) assert.equal(validateSubscription({ ...subscription, endpoint: `https://${host}` }).endpoint, `https://${host}`);
  for (const endpoint of ["http://fcm.googleapis.com/send/token", "https://127.0.0.1/token", "https://fcm.googleapis.com.evil.test/token", "https://evil.test/token", "https://fcm.googleapis.com:8443/token", "https://user@fcm.googleapis.com/token", "https://fcm.googleapis.com/token#x", "https://fcm.googleapis.com/", "file:///etc/passwd", "https://updates.push.services.mozilla.com./token", `https://fcm.googleapis.com/${"界".repeat(2000)}`]) assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  for (const keys of [{ p256dh: "a".repeat(87), auth: subscription.keys.auth }, { ...subscription.keys, auth: "a" }, { ...subscription.keys, p256dh: `${subscription.keys.p256dh}=` }]) assert.throws(() => validateSubscription({ ...subscription, keys }));
});

test("subscriptions are authenticated-encrypted at rest; malformed or tampered envelopes fail closed", () => {
  process.env.PUSH_SUBSCRIPTION_SECRET = randomBytes(32).toString("base64");
  const encrypted = encryptSubscription(subscription);
  assert.deepEqual(decryptSubscription(encrypted), subscription);
  assert.notEqual(encrypted, encryptSubscription(subscription));
  for (const secret of [subscription.endpoint, subscription.keys.auth, subscription.keys.p256dh]) assert.ok(!encrypted.includes(secret));
  const parts = encrypted.split("."); parts[2] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => decryptSubscription(parts.join(".")));
  assert.throws(() => decryptSubscription(`${encrypted}.extra`));
  process.env.PUSH_SUBSCRIPTION_SECRET = randomBytes(32).toString("base64");
  assert.throws(() => decryptSubscription(encrypted));
  delete process.env.PUSH_SUBSCRIPTION_SECRET;
  assert.throws(() => encryptSubscription(subscription));
});

test("push configuration requires a matching VAPID pair and a stable 32-byte encryption secret", () => {
  const vapid = webpush.generateVAPIDKeys();
  Object.assign(process.env, { PUSH_SUBSCRIPTION_SECRET: randomBytes(32).toString("base64"), WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_SUBJECT: "mailto:owner@example.com" });
  assert.equal(pushConfigured(), true);
  process.env.WEB_PUSH_PRIVATE_KEY = webpush.generateVAPIDKeys().privateKey;
  assert.equal(pushConfigured(), false);
  process.env.WEB_PUSH_PRIVATE_KEY = vapid.privateKey;
  process.env.PUSH_SUBSCRIPTION_SECRET = "invalid";
  assert.equal(pushConfigured(), false);
});

test("real web-push generates encrypted aes128gcm payload and valid ES256 VAPID audience/signature", () => {
  const vapid = webpush.generateVAPIDKeys();
  const payload = JSON.stringify({ title: "Anime", body: "Episode 12", url: "/anime/anime#episode-12", notificationId: 17 });
  const request = webpush.generateRequestDetails(subscription, payload, { vapidDetails: { subject: "mailto:owner@example.com", ...vapid }, TTL: 86400, contentEncoding: "aes128gcm" });
  assert.equal(request.headers["Content-Encoding"], "aes128gcm");
  assert.ok(Buffer.isBuffer(request.body));
  assert.ok(!request.body!.includes(Buffer.from(payload)));
  const require = createRequire(import.meta.url);
  const ece = require("http_ece") as { decrypt: (body: Buffer, options: object) => Buffer };
  const clear = ece.decrypt(request.body!, { version: "aes128gcm", privateKey: pair, authSecret: auth });
  assert.equal(clear.toString(), payload);
  const authorization = String(request.headers.Authorization);
  const token = authorization.match(/t=([^,]+)/)![1];
  const [header, claims, signature] = token.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "ES256");
  const decoded = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(decoded.aud, "https://fcm.googleapis.com");
  assert.equal(decoded.sub, "mailto:owner@example.com");
  const point = Buffer.from(vapid.publicKey, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1,33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
  assert.equal(verify("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
});

test("retry policy expires 404/410, retries transient failures with bounded backoff, and stops at eight attempts", () => {
  for (const status of [404, 410]) assert.equal(pushFailure(status, 1), "expired");
  for (const status of [undefined, 408, 429, 500, 503]) assert.equal(pushFailure(status, 1), "pending");
  for (const status of [400, 401, 403, 413]) assert.equal(pushFailure(status, 1), "failed");
  assert.equal(pushFailure(503, 8), "failed");
  assert.deepEqual([1,2,3,4,5,6,7,8].map(retryDelay), [30,60,120,240,480,960,1920,3600]);
});

test("service worker retains caching handlers, safely displays push and navigates to the exact episode on click", async () => {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const navigations: string[] = [], fetches: string[] = [];
  let focused = 0, closed = 0;
  const self = { location: { origin: "https://vault.example" }, addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => { handlers[type] = callback; }, registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } }, clients: { matchAll: async () => [{ url: "https://vault.example/", navigate: async (url: string) => { navigations.push(url); return { focus: async () => { focused++; } }; } }], openWindow: async (url: string) => { navigations.push(url); } } };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, fetch: async (url: string) => { fetches.push(url); } });
  for (const event of ["install", "activate", "fetch", "push", "notificationclick"]) assert.ok(handlers[event]);
  const waits: Promise<unknown>[] = [];
  const payload = { title: "Anime", body: "Episode 7", notificationId: 55, url: "/anime/test#episode-7" };
  const event = (data: unknown) => ({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  handlers.push(event(payload)); await Promise.all(waits);
  assert.equal(shown.length, 1); assert.equal(shown[0].options.tag, "vault-episode-55"); assert.equal(shown[0].options.renotify, false);
  for (const url of ["https://evil.test/anime/test#episode-7", "javascript:alert(1)", "/admin", "/anime/test", "//evil.test/anime/test#episode-7"]) handlers.push(event({ ...payload, url }));
  assert.equal(shown.length, 1);
  handlers.notificationclick({ notification: { close: () => { closed++; }, data: shown[0].options.data }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(closed, 1); assert.equal(focused, 1); assert.deepEqual(navigations, ["https://vault.example/anime/test#episode-7"]); assert.deepEqual(fetches, ["/api/notifications"]);
});
