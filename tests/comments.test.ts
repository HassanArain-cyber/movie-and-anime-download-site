import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/lib/validation";
import { parseCommentBody, parseReportDetails, parseReportReason, parseSpoiler } from "../src/lib/comment-validation";

test("comment text is bounded plain text and normalized without executable HTML", () => {
  assert.equal(parseCommentBody("  A\r\nthoughtful ending.\u0000  "), "A\nthoughtful ending.");
  assert.equal(parseCommentBody("Spoiler: the reveal was excellent."), "Spoiler: the reveal was excellent.");
  assert.throws(() => parseCommentBody(" <script>alert(1)</script> "), ApiError);
  assert.throws(() => parseCommentBody("<img src=x onerror=alert(1)>"), ApiError);
  assert.throws(() => parseCommentBody("x"), ApiError);
  assert.throws(() => parseCommentBody("x".repeat(2001)), ApiError);
  assert.throws(() => parseCommentBody("One https://a.test https://b.test https://c.test"), ApiError);
  assert.equal(parseCommentBody("One https://a.test and https://b.test"), "One https://a.test and https://b.test");
});

test("spoiler flags and report values are strictly validated and sanitized", () => {
  assert.equal(parseSpoiler(undefined), false);
  assert.equal(parseSpoiler(true), true);
  assert.throws(() => parseSpoiler("true"), ApiError);
  assert.equal(parseReportReason("harassment"), "harassment");
  assert.throws(() => parseReportReason("<script>"), ApiError);
  assert.equal(parseReportDetails("Spam\u0000 links"), "Spam  links");
  assert.equal(parseReportDetails("  \n "), null);
  assert.throws(() => parseReportDetails("<b>reason</b>"), ApiError);
  assert.throws(() => parseReportDetails("x".repeat(501)), ApiError);
});
