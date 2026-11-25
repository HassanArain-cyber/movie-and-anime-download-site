import test from "node:test";
import assert from "node:assert/strict";
import { numberedEpisodeDrafts, tvmazeEpisodeDrafts } from "../src/lib/episode-suggestions";

test("numbered anime drafts never overwrite existing season episodes", () => {
  assert.deepEqual(numberedEpisodeDrafts(4, [2, 4]), [
    { number: 1, title: "Episode 1", duration: "" },
    { number: 3, title: "Episode 3", duration: "" },
  ]);
  assert.deepEqual(numberedEpisodeDrafts(0, []), []);
  assert.deepEqual(numberedEpisodeDrafts(1_000_000, []), []);
  assert.equal(numberedEpisodeDrafts(100, [], 20).length, 20);
});

test("TVmaze drafts only include regular episodes for selected season", () => {
  const rows = tvmazeEpisodeDrafts([
    { season: 2, number: 2, name: "Second", runtime: 45 },
    { season: 2, number: 1, name: "First", runtime: 60 },
    { season: 2, number: 1, name: "Duplicate" },
    { season: 1, number: 2, name: "Other season" },
    { season: 2, number: null, name: "Special" },
    { season: 2, number: 3, name: "Saved already" },
  ], 2, [3]);
  assert.deepEqual(rows, [
    { number: 1, title: "First", duration: "60m" },
    { number: 2, title: "Second", duration: "45m" },
  ]);
  assert.deepEqual(tvmazeEpisodeDrafts([], 0, []), []);
});
