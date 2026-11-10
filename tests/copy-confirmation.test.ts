import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { COPY_DESTINATION_KEY } from "../src/lib/copy-link";
import * as copyConfirmationModule from "../src/lib/copy-confirmation";
import {
  COPY_CONFIRMATION_CHECKING, COPY_CONFIRMATION_FAILED, COPY_CONFIRMATION_INSTRUCTION,
  COPY_CONFIRMATION_MANUAL, COPY_CONFIRMATION_MISSING, COPY_CONFIRMATION_REDIRECT_MS,
  COPY_CONFIRMATION_TITLE, copyConfirmationHost, copyConfirmationStatus,
} from "../src/lib/copy-confirmation";

const SITE = "https://downloader.example/open";
const DOWNLOAD = "https://www.terabox.com/s/1abc";

/** Install a browser-like sessionStorage for one render, the way a real tab would have one. */
function withStorage<T>(run: () => T, website: string | null = SITE): T {
  const stored = new Map<string, string>();
  if (website) stored.set(COPY_DESTINATION_KEY, JSON.stringify({ website, at: Date.now() }));
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    } },
    configurable: true, writable: true,
  });
  try { return run(); } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete (globalThis as Record<string, unknown>).window;
  }
}

/** Execute the real page component with in-memory React, never @/db. */
function load(file: string, { serverSnapshot = false as boolean } = {}, imports: Record<string, unknown> = {}) {
  const react = {
    ...React,
    useState: (initial: unknown) => [initial, () => {}],
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    // Server rendering reads getServerSnapshot, hydration reads getSnapshot; cover both.
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown, getServerSnapshot?: () => unknown) =>
      (serverSnapshot ? getServerSnapshot?.() : getSnapshot()),
  };
  const loaded = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: loaded, exports: loaded.exports, URL,
    require: (name: string) => {
      const available: Record<string, unknown> = {
        react, "react/jsx-runtime": jsx,
        "next/link": { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => jsx.jsx("a", { href, ...rest, children }) },
        "@/lib/copy-link": require("../src/lib/copy-link"),
        "@/lib/copy-confirmation": copyConfirmationModule,
        ...imports,
      };
      assert.ok(name in available, `Unexpected import in ${file}: ${name}`);
      return available[name];
    },
  });
  return loaded.exports as Record<string, React.ComponentType<Record<string, unknown>>>;
}

/** Render the container the way the confirmation tab sees it. */
function pageMarkup({ website = SITE as string | null, serverSnapshot = false } = {}) {
  const Page = load("src/app/copy/CopyConfirmation.tsx", { serverSnapshot }).default;
  return withStorage(() => renderToStaticMarkup(React.createElement(Page)), website);
}

function cardMarkup(phase: string, website: string | null) {
  const Card = load("src/app/copy/CopyConfirmation.tsx", {}).CopyConfirmationCard;
  return renderToStaticMarkup(React.createElement(Card, { phase, website, onContinue: () => {} }));
}

test("the confirmation says exactly what the visitor must do next", () => {
  assert.equal(COPY_CONFIRMATION_TITLE, "Link Copied Successfully!");
  assert.equal(COPY_CONFIRMATION_INSTRUCTION, "Paste the copied link on the next website to download.");
  assert.equal(copyConfirmationStatus(), "Opening download website in 2 seconds…");
  assert.equal(copyConfirmationStatus(1), "Opening download website in 1 second…");
  assert.equal(COPY_CONFIRMATION_REDIRECT_MS, 2000, "the redirect waits two seconds, long enough to read");
});

test("the destination is only ever shown as a host, never with the download link", () => {
  assert.equal(copyConfirmationHost(SITE), "downloader.example");
  assert.equal(copyConfirmationHost("https://www.terabox.example/s/1?x=2"), "terabox.example");
  for (const bad of [null, "", "not a url", "javascript:alert(1)"]) assert.equal(copyConfirmationHost(bad), "");
});

test("the ready card shows the check, the instruction, the countdown and the manual way out", () => {
  const html = cardMarkup("ready", SITE);
  assert.match(html, /data-testid="copy-confirmation" data-phase="ready"/);
  assert.match(html, /vault-copy-confirm-check/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/, "the green check is decorative");
  assert.match(html, /Link Copied Successfully!/);
  assert.match(html, /Paste the copied link on the next website to download\./);
  assert.match(html, /Opening download website in 2 seconds…/);
  assert.match(html, /<p role="status"[^>]*>Opening download website in 2 seconds…/, "the countdown is announced politely");
  assert.match(html, /<button type="button"[^>]*>Continue to download website/, "Continue is always available");
  assert.match(html, /Destination: downloader\.example/);
  assert.doesNotMatch(html, /downloader\.example\/open|terabox|https?:/, "neither the website path nor the download link is rendered");
});

test("a failed automatic redirect explains itself and keeps the manual button", () => {
  const html = cardMarkup("failed", SITE);
  assert.match(html, /data-phase="failed"/);
  assert.match(html, new RegExp(COPY_CONFIRMATION_FAILED.replace(/\./g, "\\.")));
  assert.match(html, /Continue to download website/);
});

test("a tab without a destination never redirects and points back to the Vault", () => {
  const html = cardMarkup("missing", null);
  assert.match(html, /data-phase="missing"/);
  assert.match(html, new RegExp(COPY_CONFIRMATION_MISSING.replace(/\./g, "\\.")));
  assert.match(html, /href="\/"/, "the visitor is sent back to copy again");
  assert.doesNotMatch(html, /Continue to download website/, "there is no destination to continue to");
  assert.doesNotMatch(html, /Opening download website/);
});

test("the first paint is a quiet placeholder, so the live region never announces a guess", () => {
  const html = pageMarkup({ website: null, serverSnapshot: true });
  assert.match(html, /data-phase="checking"/);
  assert.match(html, new RegExp(COPY_CONFIRMATION_CHECKING.replace(/…/g, "\\u2026")));
  assert.doesNotMatch(html, /Continue to download website|Opening download website/);
});

test("the tab resolves its own destination from storage and renders the ready state", () => {
  const html = pageMarkup();
  assert.match(html, /data-phase="ready"/);
  assert.match(html, /Link Copied Successfully!/);
  assert.match(html, /Continue to download website/);
  assert.doesNotMatch(html, /terabox|\/copy\?/, "the download link is never part of the page state");
});

/**
 * Drive the real tab component with hooks that run: effects are captured, timers are
 * recorded, and location.replace is stubbed. This is the only way to prove the delay,
 * the single redirect and the manual retry without a browser.
 */
function drive({ website = SITE as string | null, failed = false, hydrated = true } = {}) {
  const stored = new Map<string, string>();
  if (website) stored.set(COPY_DESTINATION_KEY, JSON.stringify({ website, at: Date.now() }));
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  };
  const replaced: string[] = [];
  const timers: { delay: number; run: () => void }[] = [];
  const cleared: unknown[] = [];
  const effects: Array<() => (() => void) | void> = [];
  const browser = {
    sessionStorage: storage, opener: "the download page" as unknown,
    location: { replace: (url: string) => { replaced.push(url); } },
  };
  const fakeReact = {
    ...React,
    useState: (initial: unknown) => [failed && initial === false ? true : initial, () => {}],
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => (() => void) | void) => { effects.push(fn); },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown, getServerSnapshot?: () => unknown) =>
      (hydrated ? getSnapshot() : getServerSnapshot?.()),
  };
  const loaded = { exports: {} as Record<string, unknown> };
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true, writable: true });
  try {
    vm.runInNewContext(ts.transpileModule(readFileSync("src/app/copy/CopyConfirmation.tsx", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      module: loaded, exports: loaded.exports, URL, window: browser,
      setTimeout: (fn: () => void, delay: number) => { timers.push({ delay, run: fn }); return timers.length; },
      clearTimeout: (handle: unknown) => { cleared.push(handle); },
      require: (name: string) => ({
        react: fakeReact, "react/jsx-runtime": jsx,
        "next/link": { default: ({ href, children }: { href: string; children: React.ReactNode }) => jsx.jsx("a", { href, children }) },
        "@/lib/copy-link": require("../src/lib/copy-link"),
        "@/lib/copy-confirmation": copyConfirmationModule,
      } as Record<string, unknown>)[name],
    });
    const element = (loaded.exports.default as () => React.ReactElement<{ children: React.ReactElement<{ onContinue: () => void }> }>)();
    return { element, effects, timers, cleared, replaced, browser };
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete (globalThis as Record<string, unknown>).window;
  }
}

test("the tab redirects itself to the saved website two seconds later, once", () => {
  const tab = drive();
  assert.equal(tab.effects.length, 1, "one effect owns the countdown");
  assert.equal(tab.timers.length, 0, "the countdown starts after render, not during it");
  const cleanup = tab.effects[0]();
  assert.equal(tab.timers.length, 1);
  assert.equal(tab.timers[0].delay, COPY_CONFIRMATION_REDIRECT_MS, "two seconds: long enough to read the message");
  assert.deepEqual(tab.replaced, [], "nothing happens before the delay elapses");
  tab.timers[0].run();
  assert.deepEqual(tab.replaced, [SITE], "exactly the saved website");
  assert.equal(tab.browser.opener, null, "the destination cannot reach back into the Vault");
  if (typeof cleanup === "function") cleanup();
  assert.deepEqual(tab.cleared, [1], "leaving early cancels the pending redirect");
});

test("no destination means no countdown at all", () => {
  for (const options of [{ website: null }, { website: null, hydrated: false }, { hydrated: false }]) {
    const tab = drive(options);
    tab.effects[0]?.();
    assert.equal(tab.timers.length, 0, JSON.stringify(options));
    assert.deepEqual(tab.replaced, []);
  }
});

test("after an automatic redirect fails, Continue is the only way forward", () => {
  const tab = drive({ failed: true });
  tab.effects[0]?.();
  assert.equal(tab.timers.length, 0, "a refused redirect is not retried behind the visitor's back");
  tab.element.props.children.props.onContinue();
  assert.deepEqual(tab.replaced, [SITE], "the button retries from a fresh user gesture");
});

test("the confirmation page keeps the destination out of the URL and out of logs", () => {
  const page = readFileSync("src/app/copy/page.tsx", "utf8");
  const component = readFileSync("src/app/copy/CopyConfirmation.tsx", "utf8");
  const helpers = readFileSync("src/lib/copy-link.ts", "utf8");
  for (const [name, source] of [["page", page], ["component", component], ["helpers", helpers]] as const) {
    assert.doesNotMatch(source, /searchParams|URLSearchParams|location\.search|location\.hash|location\.href =/, `${name} must not carry state in the URL`);
    assert.doesNotMatch(source, /console\.(log|info|warn|error)/, `${name} must not log the destination`);
    assert.doesNotMatch(source, /fetch\(/, `${name} must not send the destination anywhere`);
  }
  assert.match(page, /robots: \{ index: false, follow: false \}/, "a private step is never indexed");
  assert.match(component, /window\.location\.replace\(destination\)/, "the tab redirects itself, keeping one history entry");
  assert.match(component, /COPY_CONFIRMATION_REDIRECT_MS/, "the delay is shared with the copy");
});
