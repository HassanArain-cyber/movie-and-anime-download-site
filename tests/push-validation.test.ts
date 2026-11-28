import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  endpointHash,
  isAllowedPushEndpoint,
  isValidVapidPublicKey,
  normalizePushSubscription,
  safePushRoute,
} from "../src/lib/notifications/push-validation";

const p256dh = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
const auth = randomBytes(16).toString("base64url");

test("only trusted HTTPS push services are accepted (SSRF boundary)", () => {
  for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "x.notify.windows.com"])
    assert.equal(isAllowedPushEndpoint("https://" + host + "/push/token"), true);
  for (const value of [
    "http://fcm.googleapis.com/a", "https://localhost/a",
    "https://127.0.0.1/a", "https://evil.example/a",
    "https://fcm.googleapis.com.evil.example/a",
    "https://user:password@fcm.googleapis.com/a",
    "https://fcm.googleapis.com:8443/a",
    "https://fcm.googleapis.com/a#fragment",
  ]) assert.equal(isAllowedPushEndpoint(value), false, value);
});

test("browser subscription requires valid P-256 and 16-byte auth keys", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/example";
  const valid = { endpoint, keys: { p256dh, auth } };
  assert.deepEqual(normalizePushSubscription(valid), valid);
  assert.equal(normalizePushSubscription({ ...valid, keys: { p256dh: "wrong", auth } }), null);
  assert.equal(normalizePushSubscription({ ...valid, keys: { p256dh, auth: "bad" } }), null);
  assert.equal(normalizePushSubscription({ ...valid, endpoint: "http://localhost/token" }), null);
  assert.equal(normalizePushSubscription(null), null);
  assert.equal(endpointHash(endpoint).length, 64);
  assert.equal(isValidVapidPublicKey(p256dh), true);
});

test("push click destination is internal and restricted to anime episodes", () => {
  assert.equal(safePushRoute("anime", "test-anime", 12), "/anime/test-anime#episode-12");
  assert.equal(safePushRoute("series", "demo", 2), "/series/demo#episode-2");
  assert.equal(safePushRoute("movie", "demo", 2), "/notifications");
  assert.equal(safePushRoute("anime", "../admin", 1), "/notifications");
  assert.equal(safePushRoute("anime", "demo", -1), "/notifications");
});
