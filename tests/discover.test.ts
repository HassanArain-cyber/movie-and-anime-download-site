import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicDiscoverAnime,
  normalizeDiscoverQuery,
  plainDiscoverDescription,
  safeDiscoverUrl,
} from "../src/lib/discover";

test("discover search accepts only short plain query text", () => {
  assert.equal(normalizeDiscoverQuery("  Naruto  "), "Naruto");
  assert.equal(normalizeDiscoverQuery("a\nb"), "a b");
  assert.equal(normalizeDiscoverQuery("x".repeat(150)).length, 100);
  assert.equal(normalizeDiscoverQuery(["naruto", "other"]), "");
  assert.equal(normalizeDiscoverQuery(null), "");
});

test("discover excludes adult and invalid media entries", () => {
  assert.equal(isPublicDiscoverAnime({ id: 10, isAdult: false, title: { english: "Test" } }), true);
  assert.equal(isPublicDiscoverAnime({ id: 11, isAdult: true, title: { english: "Test" } }), false);
  assert.equal(isPublicDiscoverAnime({ id: 0, isAdult: false, title: { romaji: "Test" } }), false);
  assert.equal(isPublicDiscoverAnime({ id: 11, title: { romaji: "Test" } }), false);
});

test("discover external URLs must use HTTPS without embedded credentials", () => {
  assert.equal(safeDiscoverUrl("https://example.com/watch?q=1"), "https://example.com/watch?q=1");
  assert.equal(safeDiscoverUrl("http://example.com/"), null);
  assert.equal(safeDiscoverUrl("javascript:alert(1)"), null);
  assert.equal(safeDiscoverUrl("https://user:pass@example.com/"), null);
  assert.equal(safeDiscoverUrl("/relative"), null);
  assert.equal(safeDiscoverUrl(null), null);
});

test("discover descriptions are safely rendered as text", () => {
  assert.equal(plainDiscoverDescription("<b>Anime</b> &amp; more"), "Anime & more");
  assert.equal(plainDiscoverDescription("<script>alert(1)</script>Safe"), "Safe");
  assert.equal(plainDiscoverDescription(undefined), "");
});
