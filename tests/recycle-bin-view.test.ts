import test from "node:test";
import assert from "node:assert/strict";
import { episodeFolders, type BinItem } from "../src/lib/recycle-bin-view";
const item = (id: number, mediaId: number, seasonId: number, seasonNumber: number, episodeNumber: number): BinItem => ({ id, kind: "episode", mediaId, mediaTitle: "Identical · title", seasonId, seasonNumber, episodeNumber, title: `Episode ${episodeNumber}`, type: "anime", deletedAt: "2026-11-07T00:00:00Z" });
test("episode folders use IDs, not parsed titles, and count/sort every season numerically", () => {
  const rows = [item(1, 10, 102, 2, 10), item(2, 10, 101, 1, 7), item(3, 10, 102, 2, 2), item(4, 20, 201, 1, 1), { ...item(5, 30, 301, 1, 1), kind: "media" as const }];
  const grouped = episodeFolders(rows);
  assert.equal(grouped.length, 2, "same title text must not combine distinct parents");
  assert.equal(grouped[0].count, 3);
  assert.deepEqual(grouped[0].seasons.map((season) => season.number), [1, 2]);
  assert.deepEqual(grouped[0].seasons[1].items.map((row) => row.episodeNumber), [2, 10]);
  assert.equal(grouped[1].count, 1);
  assert.equal(rows[0].id, 1, "presentation sorting must not mutate input order");
});
test("large groups remain one title folder with complete totals, even beyond one API page", () => {
  const grouped = episodeFolders(Array.from({ length: 511 }, (_, index) => item(index + 1, 1, index < 500 ? 2 : 3, index < 500 ? 1 : 2, index + 1)));
  assert.equal(grouped.length, 1); assert.equal(grouped[0].count, 511);
  assert.deepEqual(grouped[0].seasons.map((season) => season.items.length), [500, 11]);
});
test("missing presentation metadata remains recoverable without guessing parentage from text", () => {
  const grouped = episodeFolders([{ ...item(1, 1, 2, 1, 1), mediaId: null, mediaTitle: null, seasonId: null, seasonNumber: null }]);
  assert.equal(grouped[0].title, "Unknown title"); assert.equal(grouped[0].seasons[0].items[0].id, 1);
});
