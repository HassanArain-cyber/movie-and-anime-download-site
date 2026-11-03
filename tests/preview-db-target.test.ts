import test from "node:test";
import assert from "node:assert/strict";
import { checkPreviewDatabaseTarget } from "../src/lib/preview-db-target";

const endpoint = "ep-still-darkness-b5bsw66y";

test("matches a direct Neon endpoint without returning connection details", () => {
  const result = checkPreviewDatabaseTarget(
    "postgresql://private-user:private-password@ep-still-darkness-b5bsw66y.us-east-2.aws.neon.tech/neondb?sslmode=require",
    endpoint,
  );
  assert.equal(result, "match");
  assert.equal(JSON.stringify(result).includes("private-password"), false);
});

test("matches the Neon pooled endpoint form", () => {
  assert.equal(
    checkPreviewDatabaseTarget(
      "postgres://user:secret@ep-still-darkness-b5bsw66y-pooler.us-east-2.aws.neon.tech/neondb",
      endpoint,
    ),
    "match",
  );
});

test("reports a different Neon endpoint without exposing its hostname", () => {
  assert.equal(
    checkPreviewDatabaseTarget("postgres://user:secret@ep-another-branch.neon.tech/neondb", endpoint),
    "different",
  );
});

test("leaves missing, malformed, and non-Neon targets unverifiable", () => {
  assert.equal(checkPreviewDatabaseTarget(undefined, endpoint), "unverifiable");
  assert.equal(checkPreviewDatabaseTarget("not a URL", endpoint), "unverifiable");
  assert.equal(checkPreviewDatabaseTarget("postgres://user:secret@db.example.test/neondb", endpoint), "unverifiable");
});
