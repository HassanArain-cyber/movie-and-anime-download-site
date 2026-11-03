import test from "node:test";
import assert from "node:assert/strict";
import { makeResendErrorDiagnostics } from "../src/lib/resend-error-diagnostics";

test("Resend diagnostics retain documented error fields while scrubbing secrets and PII", () => {
  const diagnostics = makeResendErrorDiagnostics(422, {
    statusCode: 422,
    code: "domain_not_verified",
    type: "invalid_from_address",
    name: "validation_error",
    message: "Sender requests@example.com rejected for vault-test@example.com; Ari Smith wrote Please add season 2; key re_test-secret-token; Authorization: Bearer test-resend-key; phone +1 555-123-4567; URL https://example.com/private?key=secret",
  }, [
    "test-resend-key",
    "vault-test@example.com",
    "Vault Test <requests@example.com>",
    "requests@example.com",
    "Ari Smith",
    "Please add season 2",
    "Ari",
    "Smith",
    "Please",
    "add",
    "season",
    "2",
  ]);

  assert.equal(diagnostics.httpStatus, 422);
  assert.equal(diagnostics.providerStatusCode, 422);
  assert.equal(diagnostics.code, "domain_not_verified");
  assert.equal(diagnostics.type, "invalid_from_address");
  assert.equal(diagnostics.name, "validation_error");
  assert.equal(typeof diagnostics.message, "string");

  const serialized = JSON.stringify(diagnostics);
  for (const forbidden of [
    "requests@example.com",
    "vault-test@example.com",
    "Ari Smith",
    "Please add season 2",
    "re_test-secret-token",
    "test-resend-key",
    "+1 555-123-4567",
    "https://example.com/private",
    "secret",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }
});

test("Resend diagnostics preserve HTTP status for malformed or undocumented response bodies", () => {
  assert.deepEqual(makeResendErrorDiagnostics(503, "upstream unavailable"), { httpStatus: 503 });
});
