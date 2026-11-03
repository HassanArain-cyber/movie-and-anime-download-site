import test from "node:test";
import assert from "node:assert/strict";
import { isLibrarySort, sortMediaItems } from "../src/lib/library-filters";

const items = [
  { title: "Zulu", createdAt: "2024-01-01T00:00:00Z" },
  { title: "alpha", createdAt: "2025-01-01T00:00:00Z" },
  { title: "Beta", createdAt: "2023-01-01T00:00:00Z" },
];

test("library sorting supports all four options with case-insensitive title order", () => {
  assert.deepEqual(sortMediaItems(items, "az").map((item) => item.title), ["alpha", "Beta", "Zulu"]);
  assert.deepEqual(sortMediaItems(items, "za").map((item) => item.title), ["Zulu", "Beta", "alpha"]);
  assert.deepEqual(sortMediaItems(items, "newest").map((item) => item.title), ["alpha", "Zulu", "Beta"]);
  assert.deepEqual(sortMediaItems(items, "oldest").map((item) => item.title), ["Beta", "Zulu", "alpha"]);
});

test("only supported library sort keys are accepted", () => {
  assert.equal(isLibrarySort("az"), true);
  assert.equal(isLibrarySort("za"), true);
  assert.equal(isLibrarySort("newest"), true);
  assert.equal(isLibrarySort("oldest"), true);
  assert.equal(isLibrarySort("random"), false);
  assert.equal(isLibrarySort(null), false);
});
