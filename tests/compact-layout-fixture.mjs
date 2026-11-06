// Render real components with inert hook data; no app server, database or providers.
// Used only by following-ui.mjs to inspect the built CSS in a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const comments = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, parentId: i ? i : null, body: `Nested comment ${i + 1}`, mediaId: 1, episodeId: null, createdAt: "2026-11-06T00:00:00Z", likeCount: 1, likedByMe: false, isSpoiler: false }));
const allowed = new Map([
  ["@/components/DownloadButton", "src/components/DownloadButton.tsx"],
  ["@/components/DownloadOptions", "src/components/DownloadOptions.tsx"],
  ["@/components/CommentSection", "src/components/CommentSection.tsx"],
  ["@/lib/media-links", "src/lib/media-links.ts"],
  ["@/lib/comment-display", "src/lib/comment-display.ts"],
  ["@/lib/comment-thread", "src/lib/comment-thread.ts"],
]);
const cache = new Map();
function load(id) {
  if (id === "react/jsx-runtime") return jsx;
  if (id === "react") return { ...React, useState: (initial) => React.useState(Array.isArray(initial) ? comments : initial === true ? false : initial === 0 ? comments.length : initial) };
  assert.ok(allowed.has(id), `Unexpected fixture import: ${id}`);
  if (cache.has(id)) return cache.get(id);
  const exports = {};
  cache.set(id, exports);
  const code = ts.transpileModule(readFileSync(allowed.get(id), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: load, URL, URLSearchParams, Date });
  return exports;
}
export function compactLayoutFixture(styles) {
  const DownloadOptions = load("@/components/DownloadOptions").default;
  const CommentSection = load("@/components/CommentSection").default;
  const links = [
    { id: 1, url: "https://example.com/download", label: "VeryLongMovieDownloadLabel".repeat(12), quality: "2160p", fileSize: "123456789012345678901234567890GB" },
    { id: 2, url: "r2:///private-key", storageProvider: "r2", label: "Private movie download with a long readable label", quality: "1080p", fileSize: "4 GB" },
  ];
  const downloads = renderToStaticMarkup(React.createElement(DownloadOptions, { links }));
  const discussion = renderToStaticMarkup(React.createElement(CommentSection, { mediaId: 1, enabled: true }));
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body><main class="mx-auto max-w-7xl p-4 vault-detail-page"><div class="vault-detail"><div class="vault-detail-poster"><div class="aspect-[2/3] bg-neutral-900"></div></div><div class="min-w-0"><h1>Yuo movie layout fixture</h1>${downloads}</div></div>${discussion}</main></body></html>`;
}
