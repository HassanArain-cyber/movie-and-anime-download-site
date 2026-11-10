import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as copyToastModule from "../src/lib/copy-toast";
import {
  COPY_TOAST_EVENT, COPY_TOAST_MS, copyOutcomeEffects, copyToastText, showCopyToast, type CopyToastDetail,
} from "../src/lib/copy-toast";

// Execute real source with explicit in-memory dependencies; never import @/db.
function load(file: string, imports: Record<string, unknown>) {
  const loaded = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: loaded, exports: loaded.exports, require: (name: string) => {
    assert.ok(name in imports, `Unexpected import in ${file}: ${name}`);
    return imports[name];
  } });
  return loaded.exports as Record<string, React.ComponentType<Record<string, unknown>>>;
}

const detail = (overrides: Partial<CopyToastDetail> = {}): CopyToastDetail => ({
  outcome: "opened", host: "downloader.example", website: "https://downloader.example/open", ...overrides,
});

/** Render the real presentational card without a browser. */
function cardMarkup(value: CopyToastDetail) {
  const card = load("src/components/CopyToast.tsx", {
    react: React, "react/jsx-runtime": jsx, "@/lib/copy-toast": copyToastModule,
  }).CopyToastCard;
  return renderToStaticMarkup(React.createElement(card, { detail: value, onDismiss: () => {} }));
}
/** Render the container with its state pre-seeded, so the live region is covered. */
function containerMarkup(value: CopyToastDetail | null) {
  const toast = load("src/components/CopyToast.tsx", {
    react: { ...React,
      useState: (initial: unknown) => [initial === null ? value : initial, () => {}],
      useEffect: () => {},
    },
    "react/jsx-runtime": jsx, "@/lib/copy-toast": copyToastModule,
  }).default;
  return renderToStaticMarkup(React.createElement(toast));
}

test("a successful copy confirms itself; a failed copy keeps the manual fallback", () => {
  assert.deepEqual(copyOutcomeEffects("failed", { host: "downloader.example", website: "https://downloader.example/open" }), { toast: null, manualFallback: true });
  for (const outcome of ["copied", "opened", "blocked"] as const) {
    const effects = copyOutcomeEffects(outcome, { host: "downloader.example", website: "https://downloader.example/open" });
    assert.equal(effects.manualFallback, false, outcome);
    assert.deepEqual(effects.toast, { outcome, host: "downloader.example", website: "https://downloader.example/open" });
  }
  // Copy-only links have no website to fall back to.
  assert.deepEqual(copyOutcomeEffects("copied", { host: "", website: null }).toast, { outcome: "copied", host: "", website: null });
  assert.equal(copyOutcomeEffects("blocked", { host: "", website: null }).toast?.website, null);
});

test("the confirmation names the outcome and the site that was opened", () => {
  assert.equal(copyToastText(detail({ outcome: "copied", host: "", website: null })), "Link copied to clipboard.");
  assert.equal(copyToastText(detail()), "Link copied. downloader.example opened in a new tab — paste the link there.");
  assert.equal(copyToastText(detail({ outcome: "blocked" })), "Link copied. Your browser blocked the new tab for downloader.example.");
  assert.ok(COPY_TOAST_MS >= 3000 && COPY_TOAST_MS <= 10000, "a confirmation should stay long enough to read, not forever");
});

test("the toast is announced, dismissible and offers the blocked-tab link", () => {
  const opened = cardMarkup(detail());
  assert.match(opened, /data-testid="copy-toast" data-outcome="opened"/);
  assert.match(opened, /role="status" aria-live="polite" aria-atomic="true"/, "each confirmation announces itself politely");
  assert.match(opened, /Link copied\. downloader\.example opened in a new tab — paste the link there\./);
  assert.match(opened, /aria-label="Dismiss copy confirmation"/);
  assert.doesNotMatch(opened, /Open downloader\.example/, "a site that opened needs no manual link");

  const blocked = cardMarkup(detail({ outcome: "blocked" }));
  assert.match(blocked, /data-outcome="blocked"/);
  assert.match(blocked, /Your browser blocked the new tab/);
  assert.match(blocked, /<a href="https:\/\/downloader\.example\/open" target="_blank" rel="noopener noreferrer"/);
  assert.match(blocked, />Open downloader\.example</);

  // Copy-only links confirm without promising a site.
  const copied = cardMarkup(detail({ outcome: "copied", host: "", website: null }));
  assert.match(copied, /Link copied to clipboard\./);
  assert.doesNotMatch(copied, />Open </);
});

test("nothing is rendered until a copy succeeds, so other status messages stay alone", () => {
  const empty = containerMarkup(null);
  assert.doesNotMatch(empty, /role="status"/, "an idle page must not add its own status region");
  assert.doesNotMatch(empty, /data-testid="copy-toast"/, "nothing is shown until a copy succeeds");

  const shown = containerMarkup(detail({ outcome: "blocked" }));
  assert.equal(shown.match(/role="status"/g)?.length, 1);
  assert.match(shown, /aria-live="polite"/);
  assert.match(shown, /data-testid="copy-toast"/);
  assert.match(shown, /Open downloader\.example/);
});

test("announcing a copy is a plain window event and works outside the browser", () => {
  const seen: { type: string; detail: unknown }[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { dispatchEvent: (event: Event) => { seen.push({ type: event.type, detail: (event as CustomEvent).detail }); return true; } },
    configurable: true, writable: true,
  });
  try {
    const announced = detail({ outcome: "blocked" });
    showCopyToast(announced);
    assert.deepEqual(seen.map((entry) => entry.type), [COPY_TOAST_EVENT]);
    assert.deepEqual(seen[0].detail, announced);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original); else delete (globalThis as Record<string, unknown>).window;
  }
  assert.doesNotThrow(() => showCopyToast(detail()), "server rendering must not need a window");
});

test("the toast stays presentation-only and the button never toasts a failed copy", () => {
  const toastSource = readFileSync("src/lib/copy-toast.ts", "utf8");
  assert.doesNotMatch(toastSource, /navigator\.clipboard|execCommand|fetch\(|localStorage|sessionStorage|@\/db/);
  const componentSource = readFileSync("src/components/CopyToast.tsx", "utf8");
  assert.doesNotMatch(componentSource, /navigator\.clipboard|execCommand|fetch\(|localStorage|sessionStorage/);

  const button = readFileSync("src/components/DownloadButton.tsx", "utf8");
  assert.match(button, /const effects = copyOutcomeEffects\(next, \{ host, website \}\);/);
  assert.match(button, /setFailure\(effects\.manualFallback \? "failed" : null\);/);
  assert.match(button, /if \(effects\.toast\) showCopyToast\(effects\.toast\);/);
  assert.match(button, /failure === "failed" &&/, "the URL fallback only renders for a failed copy");
  // The inline success text is gone: success is announced by the toast only.
  assert.doesNotMatch(button, /Link copied to clipboard\./);
  assert.doesNotMatch(button, /opened in a new tab — paste the link there/);
  assert.match(readFileSync("src/app/layout.tsx", "utf8"), /<CopyToast \/>/, "one toast is mounted for every page");
});
