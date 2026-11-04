import test from "node:test";
import assert from "node:assert/strict";
import { formatCommentTimestamp } from "../src/lib/comment-display";

test("comment metadata renders the exact compact date and time format", () => {
  assert.equal(formatCommentTimestamp("2026-11-04T04:45:00.000Z", "Asia/Karachi"), "Nov 4, 2026 · 9:45 AM");
  assert.equal(formatCommentTimestamp("2026-11-04T16:05:00.000Z", "Asia/Karachi"), "Nov 4, 2026 · 9:05 PM");
  assert.equal(formatCommentTimestamp("2024-01-09T09:30:00.000Z", "UTC"), "Jan 9, 2024 · 9:30 AM");
});

test("the four-digit year is always shown, including the current year", () => {
  const formatted = formatCommentTimestamp("2026-11-04T04:45:00.000Z", "UTC");
  assert.equal(formatted, "Nov 4, 2026 · 4:45 AM");
  assert.match(formatted, /, \d{4} · /, "a four-digit year is always present");
});

test("unparseable timestamps fall back to a neutral label", () => {
  assert.equal(formatCommentTimestamp("not-a-date", "UTC"), "Recently");
});
