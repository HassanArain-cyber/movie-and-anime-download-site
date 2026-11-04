import test from "node:test";
import assert from "node:assert/strict";
import { formatCommentTimestamp } from "../src/lib/comment-display";

test("current-year comments hide the year", () => {
  assert.equal(
    formatCommentTimestamp("2026-11-04T04:45:00.000Z", "Asia/Karachi", new Date("2026-11-04T12:00:00.000Z")),
    "Nov 4 · 9:45 AM",
  );
  assert.equal(
    formatCommentTimestamp("2026-11-04T16:05:00.000Z", "Asia/Karachi", new Date("2026-11-04T12:00:00.000Z")),
    "Nov 4 · 9:05 PM",
  );
});

test("previous-year comments keep the four-digit year", () => {
  assert.equal(
    formatCommentTimestamp("2026-11-04T04:45:00.000Z", "Asia/Karachi", new Date("2027-01-01T00:00:00.000Z")),
    "Nov 4, 2026 · 9:45 AM",
  );
  assert.equal(
    formatCommentTimestamp("2024-01-09T09:30:00.000Z", "UTC", new Date("2026-01-01T00:00:00.000Z")),
    "Jan 9, 2024 · 9:30 AM",
  );
});

test("the year comparison advances automatically with the current year", () => {
  const now2028 = new Date("2028-06-01T00:00:00.000Z");
  assert.equal(formatCommentTimestamp("2027-11-04T04:45:00.000Z", "Asia/Karachi", now2028), "Nov 4, 2027 · 9:45 AM");
  assert.equal(formatCommentTimestamp("2028-11-04T04:45:00.000Z", "Asia/Karachi", now2028), "Nov 4 · 9:45 AM");
});

test("the calendar year is compared in the viewer timezone", () => {
  // 20:00 UTC on Dec 31 2026 is already Jan 1 2027 in Asia/Karachi.
  assert.equal(
    formatCommentTimestamp("2026-12-31T20:00:00.000Z", "Asia/Karachi", new Date("2027-01-01T00:30:00.000Z")),
    "Jan 1 · 1:00 AM",
  );
});

test("unparseable timestamps fall back to a neutral label", () => {
  assert.equal(formatCommentTimestamp("not-a-date", "UTC"), "Recently");
});
