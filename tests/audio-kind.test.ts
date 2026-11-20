import test from "node:test";
import assert from "node:assert/strict";
import { isAudioOnlyDownload } from "../src/lib/media-links";

test("audio-only files expose audio choices without guessing unknown sources", () => {
  assert.equal(isAudioOnlyDownload({ url: "https://example.com/music.mp3?download=1", label: null }), true);
  assert.equal(isAudioOnlyDownload({ url: "r2:///audio/voice.flac", label: null }), true);
  assert.equal(isAudioOnlyDownload({ url: "https://example.com/opaque-link", label: "Audio - Urdu" }), true);
  assert.equal(isAudioOnlyDownload({ url: "https://example.com/video.mkv", label: "Dual Audio 1080p" }), false);
  assert.equal(isAudioOnlyDownload({ url: "https://example.com/movie.mp4", label: "1080p" }), false);
  assert.equal(isAudioOnlyDownload({ url: "https://drive.google.com/file/d/abc", label: null }), false);
});
