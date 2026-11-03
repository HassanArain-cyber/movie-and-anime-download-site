import test from "node:test";
import assert from "node:assert/strict";
import {
  getSearchCandidatePatterns,
  getSearchQueryForms,
  isSearchableContentType,
  normalizeSearchText,
  rankSearchMatch,
} from "../src/lib/search";

test("search normalization and expandable acronym aliases support common titles", () => {
  assert.equal(normalizeSearchText("  Jujutsu—Kaisen! "), "jujutsu kaisen");
  assert.ok(getSearchQueryForms("JJK").some((form) => form.alias && form.text === "jujutsu kaisen"));
  assert.ok(getSearchQueryForms("DBZ").some((form) => form.text === "dragon ball z"));
  assert.ok(getSearchQueryForms("SAO").some((form) => form.text === "sword art online"));
  assert.ok(getSearchQueryForms("AOT").some((form) => form.text === "attack on titan"));
});

test("search ranking puts exact matches above aliases and typo-tolerant matches", () => {
  const exact = rankSearchMatch("JJK", "JJK")!;
  const alias = rankSearchMatch("JJK", "Jujutsu Kaisen")!;
  const typo = rankSearchMatch("Jujutsu Kasien", "Jujutsu Kaisen")!;
  assert.ok(exact.score > alias.score);
  assert.ok(alias.score > typo.score);
});

test("fuzzy matching handles transposed, missing, and extra letters but rejects weak matches", () => {
  assert.ok(rankSearchMatch("Jujutsu Kasien", "Jujutsu Kaisen"));
  assert.ok(rankSearchMatch("Jujutsu Kasen", "Jujutsu Kaisen"));
  assert.ok(rankSearchMatch("Jujutsu Kaaisen", "Jujutsu Kaisen"));
  assert.equal(rankSearchMatch("xxxyyy", "Jujutsu Kaisen"), null);

  const transpositionPatterns = getSearchCandidatePatterns("Kasien");
  const missingLetterPatterns = getSearchCandidatePatterns("Kasen");
  assert.ok(transpositionPatterns.includes("%kaisen%"));
  assert.ok(missingLetterPatterns.includes("%ka_sen%"));
});

test("content type validation only accepts the three catalog types", () => {
  assert.equal(isSearchableContentType("movie"), true);
  assert.equal(isSearchableContentType("anime"), true);
  assert.equal(isSearchableContentType("series"), true);
  assert.equal(isSearchableContentType("all"), false);
  assert.equal(isSearchableContentType(null), false);
});
