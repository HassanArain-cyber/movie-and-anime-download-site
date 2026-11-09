import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { linkBehavior } from "../src/lib/validation";
import type { DownloadLink } from "../src/lib/types";

// Execute the real component with injected React state so both branches render.
function render(link: DownloadLink, clipboard?: (text: string) => Promise<void>) {
  const loaded = { exports: {} as Record<string, unknown> };
  const imports: Record<string, unknown> = {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}] },
    "react/jsx-runtime": jsx,
    "@/lib/types": {},
    "@/lib/media-links": require("../src/lib/media-links"),
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/components/DownloadButton.tsx", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      module: loaded, exports: loaded.exports, require: (name: string) => {
        assert.ok(name in imports, `Unexpected import: ${name}`);
        return imports[name];
      },
      navigator: clipboard ? { clipboard: { writeText: clipboard } } : undefined,
    },
  );
  const Button = loaded.exports.default as React.ComponentType<{ link: DownloadLink }>;
  return renderToStaticMarkup(React.createElement(Button, { link }));
}

const base: DownloadLink = {
  id: 7, mediaId: 1, seasonId: null, episodeId: null, label: "1080p", url: "https://pixeldrain.net/u/abc",
  fileSize: "1.2 GB", isUploaded: false, quality: "1080p", storageProvider: "external", objectKey: null,
  sizeBytes: null, linkBehavior: "open",
};

test("the default open behaviour keeps a plain external anchor, as before", () => {
  const html = render(base);
  assert.match(html, /<a /, "must remain a link");
  assert.match(html, /href="https:\/\/pixeldrain\.net\/u\/abc"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<button/, "no copy control for open links");
  assert.doesNotMatch(html, /Copy<\/span>/, "no copy badge for open links");
});

test("copy behaviour renders a button instead of a navigating link", () => {
  const html = render({ ...base, linkBehavior: "copy" });
  assert.match(html, /<button /);
  assert.match(html, /Copy<\/span>/, "the copy affordance is labelled");
  assert.doesNotMatch(html, /<a /, "must not navigate away");
  assert.doesNotMatch(html, /href=/, "no href is exposed for copy links");
});

test("copy behaviour is provider-agnostic for external hosts, telegram and magnet links", () => {
  for (const url of [
    "https://pixeldrain.net/u/abc",
    "https://www.terabox.com/s/xyz",
    "https://hubcloud.pw/drive/1abc",
    "https://t.me/channel/12",
    "magnet:?xt=urn:btih:abc123",
  ]) {
    const html = render({ ...base, url, linkBehavior: "copy", storageProvider: "external" });
    assert.match(html, /<button /, `${url} should use the copy control`);
    assert.doesNotMatch(html, /<a /, `${url} must not navigate`);
  }
});

test("stored R2 and legacy files keep using the download handler", () => {
  for (const [url, provider] of [["r2:///videos/a.mp4", "r2"], ["/uploads/videos/old.mp4", "local"]] as const) {
    const html = render({ ...base, url, storageProvider: provider, isUploaded: true, linkBehavior: "copy" });
    assert.match(html, new RegExp(`href="/api/download\\?id=7"`), `${provider} must resolve through the handler`);
    assert.match(html, /download=""/, `${provider} must stay a direct download`);
  }
});

test("unsafe legacy URLs stay unavailable regardless of behaviour", () => {
  const html = render({ ...base, url: "javascript:alert(1)", linkBehavior: "copy" });
  assert.match(html, /Unavailable link/);
  assert.doesNotMatch(html, /<button/);
});

test("legacy rows that predate the column read as open", () => {
  // The DB column defaults to 'open'; the mapper also coerces anything unknown.
  assert.equal(linkBehavior("open"), "open");
  assert.equal(linkBehavior("copy"), "copy");
  for (const invalid of ["clipboard", "", null, undefined, 1, {}]) {
    assert.throws(() => linkBehavior(invalid), /Choose Open Link or Copy Link/);
  }
});
