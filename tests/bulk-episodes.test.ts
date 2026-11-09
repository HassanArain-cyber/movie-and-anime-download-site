import test from "node:test";
import assert from "node:assert/strict";
import { BulkApiError, guessEpisodeNumber, processBulkEpisode, validateBulkEpisodes, type BulkEpisodeRow } from "../src/lib/bulk-episodes";
import type { CompletedUpload } from "../src/lib/types";

const row = (id = "1", number = "1"): BulkEpisodeRow => ({ id, number, title: `Episode ${number}`, duration: "24m", url: `https://example.com/${number}.mp4`, quality: "1080p", status: "pending", progress: 0 });

test("bulk rows validate required fields, URLs, numbers, duplicates, and existing season numbers", () => {
  assert.deepEqual(validateBulkEpisodes([row()], []), {});
  for (const patch of [{ number: "" }, { number: "1.2" }, { title: " " }, { url: "" }, { url: "javascript:alert(1)" }, { duration: "a".repeat(21) }]) {
    assert.ok(validateBulkEpisodes([{ ...row(), ...patch }], [])["1"]);
  }
  assert.equal(Object.keys(validateBulkEpisodes([row(), row("2")], [])).length, 2);
  assert.match(validateBulkEpisodes([row()], [{ id: 5, episodeNumber: 1 }])["1"], /already exists/);
  assert.deepEqual(validateBulkEpisodes([{ ...row(), episodeId: 5 }], [{ id: 5, episodeNumber: 1 }]), {});
  const file = new File(["video"], "S01E03.mp4");
  assert.deepEqual(validateBulkEpisodes([{ ...row(), file, url: "" }], []), {});
  assert.match(validateBulkEpisodes([{ ...row(), file }], [])["1"], /not both/);
  assert.ok(validateBulkEpisodes([{ ...row(), file: new File([], "empty.mp4"), url: "" }], [])["1"]);
});

test("multi-file matching guesses common episode names without inventing a number", () => {
  assert.equal(guessEpisodeNumber("Anime.S01E03.1080p.mp4"), "3");
  assert.equal(guessEpisodeNumber("EP 004.mkv"), "4");
  assert.equal(guessEpisodeNumber("05.mp4"), "5");
  assert.equal(guessEpisodeNumber("anime.mp4"), "");
});

test("partial failure preserves successful episodes and retries only attachment for the failed row", async () => {
  let creates = 0, attachments = 0;
  let fail = true;
  const services = {
    create: async () => ({ id: ++creates }),
    upload: async () => { throw Error("not used"); },
    links: async () => [],
    attach: async (entry: BulkEpisodeRow) => { if (entry.number === "2" && fail) throw new BulkApiError("Temporary failure"); attachments++; },
  };
  const first = await processBulkEpisode(row(), services, () => undefined);
  let second = await processBulkEpisode(row("2", "2"), services, () => undefined);
  assert.equal(first.status, "done");
  assert.equal(second.status, "error");
  assert.equal(second.episodeId, 2);
  fail = false;
  second = await processBulkEpisode(second, services, () => undefined);
  assert.equal(second.status, "done");
  assert.equal(creates, 2);
  assert.equal(attachments, 2);
});

test("R2 completed checkpoint is retained when attach fails, so retry does not upload twice", async () => {
  let uploads = 0, creates = 0, failed = true;
  const completed: CompletedUpload = { id: "upload", url: "/api/download?id=1", objectKey: "private/episode", fileName: "1.mp4", sizeBytes: 5, contentType: "video/mp4", kind: "video", quality: "1080p" };
  const services = {
    create: async () => ({ id: ++creates }),
    upload: async () => { uploads++; return completed; },
    links: async () => [],
    attach: async () => { if (failed) throw Error("attach failed"); },
  };
  let result = await processBulkEpisode({ ...row(), url: "", file: new File(["video"], "1.mp4") }, services, () => undefined);
  assert.equal(result.completed?.id, "upload");
  failed = false;
  result = await processBulkEpisode(result, services, () => undefined);
  assert.equal(result.status, "done"); assert.equal(uploads, 1); assert.equal(creates, 1);
});

test("attachment reconciliation avoids duplicate links after a lost response", async () => {
  let attached = false;
  const result = await processBulkEpisode({ ...row(), episodeId: 42 }, {
    create: async () => { throw Error("must not recreate"); }, upload: async () => { throw Error("not used"); },
    links: async () => [{ id: 1, mediaId: 1, seasonId: 1, episodeId: 42, label: "1080p", url: row().url, quality: "1080p", fileSize: null, isUploaded: false, objectKey: null, sizeBytes: null, storageProvider: "external", linkBehavior: "open" }],
    attach: async () => { attached = true; },
  }, () => undefined);
  assert.equal(result.status, "done"); assert.equal(attached, false);
});

test("uncertain creation failures require review rather than blindly duplicating an episode", async () => {
  const result = await processBulkEpisode(row(), {
    create: async () => { throw new TypeError("Network error"); }, upload: async () => { throw Error("not used"); }, links: async () => [], attach: async () => undefined,
  }, () => undefined);
  assert.equal(result.uncertainCreation, true);
  assert.ok(validateBulkEpisodes([result], [])["1"]);
});

test("saved and uncertain rows cannot be accidentally submitted again", async () => {
  const forbidden = async (): Promise<never> => { throw Error("must not call service"); };
  const services = { create: forbidden, upload: forbidden, links: forbidden, attach: forbidden };
  const saved: BulkEpisodeRow = { ...row(), status: "done", episodeId: 1 };
  assert.equal(await processBulkEpisode(saved, services, () => undefined), saved);
  const uncertain: BulkEpisodeRow = { ...row(), status: "error", uncertainCreation: true };
  assert.equal(await processBulkEpisode(uncertain, services, () => undefined), uncertain);
});
