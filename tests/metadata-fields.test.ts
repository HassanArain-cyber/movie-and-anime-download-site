import test from "node:test";
import assert from "node:assert/strict";
import { metadataFields, optionalEpisodeCount } from "../src/lib/metadata-input";

test("import metadata accepts genres and identifiers but never invents an episode count", () => {
  assert.deepEqual(metadataFields({ genres: "Action, Adventure", episodeCount: 12, externalSource: "anilist", externalId: "151807" }), {
    genres: "Action, Adventure", episodeCount: 12, externalSource: "anilist", externalId: "151807",
  });
  assert.deepEqual(metadataFields({}), { genres: null, episodeCount: null, externalSource: null, externalId: null });
  assert.equal(optionalEpisodeCount("24"), 24);
});
test("import metadata rejects invalid counts, providers, and malformed IDs", () => {
  for (const episodeCount of [-1, 0, "12.5", "infinite", 999999]) {
    assert.throws(() => optionalEpisodeCount(episodeCount));
  }
  assert.throws(() => metadataFields({ externalSource: "evil", externalId: "123" }));
  assert.throws(() => metadataFields({ externalSource: "anilist", externalId: "abc" }));
  assert.throws(() => metadataFields({ externalSource: "anilist" }));
  assert.throws(() => metadataFields({ genres: "X".repeat(501) }));
});
