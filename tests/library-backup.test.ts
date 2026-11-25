import test from "node:test";
import assert from "node:assert/strict";
import {
  createLibraryBackup, parseLibraryBackup, mergeLibraryBackup, cleanWatchedEpisodes,
  BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES,
} from "../src/lib/library-backup";

const savedFollow = {
  source: "anilist" as const, externalId: 101, title: "Example",
  posterUrl: "https://example.com/poster.png", addedAt: 1234,
};

test("versioned library backup keeps only safe library state", () => {
  const backup = createLibraryBackup({
    vaultFollows: [{ id: 17, watchStatus: "watching" }, { id: 17, watchStatus: "on_hold" }, { id: -1, watchStatus: "watched" }],
    calendarFollows: [savedFollow, { ...savedFollow, title: "Duplicate" }],
    watchedEpisodes: { "17": [1, 1, 3, -5, "2"], bad: [19] },
    continueWatching: [
      { mediaId: 17, title: "Example", href: "/anime/example#episode-3", episodeNumber: 3, posterUrl: "javascript:alert(1)", updatedAt: 4 },
      { mediaId: 18, title: "Unsafe", href: "https://evil.example", episodeNumber: 1, updatedAt: 5 },
    ],
  });
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.deepEqual(backup.vaultFollows, [{ id: 17, watchStatus: "on_hold" }]);
  assert.equal(backup.calendarFollows.length, 1);
  assert.deepEqual(backup.watchedEpisodes, { "17": [1, 3] });
  assert.equal(backup.continueWatching.length, 1);
  assert.equal(backup.continueWatching[0].posterUrl, null);
  assert.deepEqual(parseLibraryBackup(JSON.stringify(backup)), backup);
  assert.equal(JSON.stringify(backup).includes("cookie"), false);
});

test("import merges lists and never removes existing watched episodes", () => {
  const existing = createLibraryBackup({
    vaultFollows: [{ id: 1, watchStatus: "watching" }],
    calendarFollows: [savedFollow],
    watchedEpisodes: { "1": [1, 2] },
    continueWatching: [{ mediaId: 1, title: "Old", href: "/anime/old#episode-1", episodeNumber: 1, updatedAt: 5 }],
  });
  const incoming = createLibraryBackup({
    vaultFollows: [{ id: 2, watchStatus: "watched" }],
    calendarFollows: [{ ...savedFollow, externalId: 200 }],
    watchedEpisodes: { "1": [2, 3], "2": [4] },
    continueWatching: [{ mediaId: 1, title: "New", href: "/anime/new#episode-2", episodeNumber: 2, updatedAt: 6 }],
  });
  const merged = mergeLibraryBackup(existing, incoming);
  assert.deepEqual(merged.watchedEpisodes, { "1": [1, 2, 3], "2": [4] });
  assert.equal(merged.calendarFollows.length, 2);
  assert.equal(merged.continueWatching[0].title, "New");
  assert.equal(merged.vaultFollows.length, 2);
});

test("invalid format, version, unsafe paths and oversized backups are rejected", () => {
  assert.throws(() => parseLibraryBackup("{}"), /Unsupported/);
  assert.throws(() => parseLibraryBackup("not json"), /valid JSON/);
  assert.throws(() => parseLibraryBackup("x".repeat(MAX_BACKUP_BYTES + 1)), /too large/);
  const invalid = { ...createLibraryBackup({
    vaultFollows: [], calendarFollows: [], watchedEpisodes: {}, continueWatching: [],
  }), version: 999 };
  assert.throws(() => parseLibraryBackup(JSON.stringify(invalid)), /Unsupported/);
  assert.deepEqual(cleanWatchedEpisodes({ __proto__: null, "20": [5, 5, null] }), { "20": [5] });
});
