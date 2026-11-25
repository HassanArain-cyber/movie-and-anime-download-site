import test from "node:test";
import assert from "node:assert/strict";
import { classifyHeadStatus, getMediaAuditHref, isPublicIPv4, safeProbeUrl } from "../src/lib/link-health";

test("HTTP checks never mark login, rate limits or redirects as broken", () => {
  assert.equal(classifyHeadStatus(200).status, "reachable");
  assert.equal(classifyHeadStatus(204).status, "reachable");
  assert.equal(classifyHeadStatus(301).status, "review");
  assert.equal(classifyHeadStatus(401).status, "review");
  assert.equal(classifyHeadStatus(403).status, "review");
  assert.equal(classifyHeadStatus(405).status, "review");
  assert.equal(classifyHeadStatus(429).status, "review");
  assert.equal(classifyHeadStatus(502).status, "review");
  assert.equal(classifyHeadStatus(404).status, "broken");
  assert.equal(classifyHeadStatus(410).status, "broken");
});

test("audit refuses non-public addresses, special domains and arbitrary ports", () => {
  assert.ok(safeProbeUrl("https://example.org/file.mp4"));
  for (const address of [
    "http://example.org/file", "https://127.0.0.1/", "https://localhost/",
    "https://localhost.evil.invalid/", "https://dev.internal/",
    "https://test.local/", "https://[::1]/", "https://example.org:3000/",
    "https://user:pass@example.org/", "https://example.invalid/",
    "https://example.org:8443/", "tg://resolve?domain=test",
  ]) assert.equal(safeProbeUrl(address), null, address);
});

test("public IPv4 detection excludes RFC1918, loopback and cloud metadata IPs", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.100.100.100", "0.0.0.0", "224.1.1.1", "198.18.0.1", "192.0.2.4"]) {
    assert.equal(isPublicIPv4(ip), false, ip);
  }
  assert.equal(isPublicIPv4("8.8.8.8"), true);
  assert.equal(isPublicIPv4("1.1.1.1"), true);
  assert.equal(isPublicIPv4("::1"), false);
});

test("link audit navigates to the exact movie, anime or series entry", () => {
  assert.equal(getMediaAuditHref("anime", "tokyo-revengers", 128), "/anime/tokyo-revengers#episode-128");
  assert.equal(getMediaAuditHref("series", "x-men", 30), "/series/x-men#episode-30");
  assert.equal(getMediaAuditHref("movie", "avengers", null), "/movie/avengers");
  assert.equal(getMediaAuditHref("movie", "avengers", 999), "/movie/avengers");
  assert.equal(getMediaAuditHref("anime", "anime", null), "/anime/anime");
  assert.equal(getMediaAuditHref("anime", "space anime", 11), "/anime/space%20anime#episode-11");
  assert.equal(getMediaAuditHref("anime", "../movie/other", 4), "/anime/..%2Fmovie%2Fother#episode-4");
  assert.equal(getMediaAuditHref("unknown", "anime", 1), null);
  assert.equal(getMediaAuditHref("anime", "", null), null);
  assert.equal(getMediaAuditHref("anime", null, null), null);
  assert.equal(getMediaAuditHref("anime", "abc\nxyz", 1), null);
});
