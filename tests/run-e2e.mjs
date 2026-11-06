// Disposable-service E2E runner used by CI and local verification.
// It refuses non-loopback database/app/provider targets so it cannot
// accidentally mutate production data or contact real providers.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const appPort = Number(process.env.E2E_APP_PORT || 3001);
const r2Port = Number(process.env.MOCK_R2_PORT || 9000);
const resendPort = Number(process.env.MOCK_RESEND_PORT || 9001);
const base = `http://127.0.0.1:${appPort}`;
const dbUrl = process.env.DATABASE_URL || `postgresql://postgres:postgres@127.0.0.1:5433/postgres`;
const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
function assertLoopback(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} is not a valid URL`); }
  if (!loopback.has(url.hostname)) throw new Error(`${name} must be loopback for E2E; refusing to touch a remote service`);
}
assertLoopback(dbUrl, "DATABASE_URL");
assertLoopback(base, "E2E_BASE_URL");

const password = process.env.E2E_ADMIN_PASSWORD || "test-admin-password";
const env = {
  ...process.env,
  CRON_SECRET: randomBytes(32).toString("hex"),
  DATABASE_URL: dbUrl,
  E2E_BASE_URL: base,
  E2E_ADMIN_PASSWORD: password,
  ADMIN_PASSWORD: password,
  ADMIN_EMAIL: "vault-test@example.com",
  RESEND_API_KEY: "test-resend-key",
  RESEND_FROM_EMAIL: "Vault Test <requests@example.com>",
  RESEND_API_URL: `http://127.0.0.1:${resendPort}/emails`,
  MOCK_RESEND_PORT: String(resendPort),
  MOCK_RESEND_API_KEY: "test-resend-key",
  CONTACT_RATE_LIMIT_SECRET: "e2e-contact-secret",
  CONTACT_RATE_LIMIT_WINDOW_SECONDS: "900",
  CONTACT_RATE_LIMIT_MAX_ATTEMPTS: "5",
  CONTACT_RATE_LIMIT_GLOBAL_MAX_ATTEMPTS: "1000",
  APP_ORIGIN: base,
  NEXT_TELEMETRY_DISABLED: "1",
  ADMIN_LOGIN_TRUSTED_IP_HEADER: "x-e2e-client-ip",
  ADMIN_LOGIN_WINDOW_SECONDS: process.env.ADMIN_LOGIN_WINDOW_SECONDS || "5",
  ADMIN_LOGIN_MAX_ATTEMPTS: process.env.ADMIN_LOGIN_MAX_ATTEMPTS || "5",
  ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS: process.env.ADMIN_LOGIN_GLOBAL_MAX_ATTEMPTS || "1000",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET_NAME: "test-bucket",
  R2_ENDPOINT: `http://127.0.0.1:${r2Port}`,
  R2_PART_SIZE_BYTES: String(5 * 1024 * 1024),
  MOCK_R2_PORT: String(r2Port),
  MOCK_R2_BUCKET_NAME: "test-bucket",
  MOCK_R2_ACCESS_KEY_ID: "test-access-key",
  MOCK_R2_SECRET_ACCESS_KEY: "test-secret-key",
};
assertLoopback(env.R2_ENDPOINT, "R2_ENDPOINT");
assertLoopback(env.RESEND_API_URL, "RESEND_API_URL");

await mkdir("test-results", { recursive: true });
const children = [];
async function run(command, args, runEnv = env) {
  const child = spawn(command, args, { env: runEnv, stdio: ["ignore", "inherit", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderr = (stderr + chunk.toString()).slice(-12000);
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    // Keep the original failure/exit behavior. Surface the bounded diagnostic in
    // check annotations too, when downloadable Actions logs are inaccessible.
    if (process.env.GITHUB_ACTIONS === "true" && stderr) {
      const diagnostic = stderr
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted database URL]")
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|re_[A-Za-z0-9_-]+)\b/g, "[redacted token]")
        .replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
      console.error(`::error title=Disposable browser/API test failure::${diagnostic}`);
    }
    throw new Error(`${command} ${args.join(" ")} exited ${code}`);
  }
}
async function start(name, command, args) {
  const log = path.join("test-results", `${name}.log`);
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  children.push({ name, child, log, chunks });
  return child;
}
async function waitFor(url, name, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(url); if (res.ok || res.status === 403 || res.status === 404) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not become ready`);
}
async function cleanup() {
  for (const { child } of children.reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.all(children.map(async ({ child }) => {
    if (child.exitCode !== null) return;
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await once(child, "exit").catch(() => undefined);
    clearTimeout(timer);
  }));
  for (const { log, chunks } of children) await writeFile(log, Buffer.concat(chunks)).catch(() => undefined);
}

let failure;
try {
  await run("node", ["tests/seed-legacy.mjs"]);
  await run(process.execPath, ["--import", "tsx", "tests/notification-fanout-integration.mjs"]);
  await start("mock-r2", process.execPath, ["tests/mock-r2.mjs"]);
  await start("mock-resend", process.execPath, ["tests/mock-resend.mjs"]);
  await waitFor(`http://127.0.0.1:${resendPort}/last`, "mock Resend", 15000);
  await waitFor(`http://127.0.0.1:${r2Port}/`, "mock R2", 15000).catch(async (error) => {
    // A 403/404 still proves the listener is up.
    try { await fetch(`http://127.0.0.1:${r2Port}/`); } catch { throw error; }
  });
  await start("next-app", process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)]);
  await waitFor(`${base}/api/health`, "Next app");
  await run(process.execPath, ["tests/e2e.mjs"]);
  await run(process.execPath, ["tests/notifications-e2e.mjs"]);
  await run(process.execPath, ["tests/recycle-bin-e2e.mjs"]);
} catch (error) {
  failure = error;
} finally {
  await cleanup();
  if (!failure) {
    try {
      const app = children.find(({ name }) => name === "next-app");
      const logs = app ? Buffer.concat(app.chunks).toString("utf8") : "";
      for (const expected of [
        '"httpStatus":422',
        '"providerStatusCode":422',
        '"code":"domain_not_verified"',
        '"type":"invalid_from_address"',
        '"name":"validation_error"',
        '"message":',
      ]) assert.ok(logs.includes(expected), `safe Resend diagnostics missing ${expected}`);
      for (const forbidden of [
        "vault-test@example.com",
        "requests@example.com",
        "Saved First",
        "[MOCK_FAIL]",
        "re_test-secret-token",
        "test-resend-key",
        "+1 555-123-4567",
        "https://example.com/private",
        "deliberately-private-provider-body",
      ]) assert.equal(logs.includes(forbidden), false, `server logs leaked ${forbidden}`);
    } catch (error) {
      failure = error;
    }
  }
  if (failure) {
    for (const { name, log } of children) console.error(`\n--- ${name} log: ${log} ---`);
    console.error(failure);
    process.exitCode = 1;
  }
}
