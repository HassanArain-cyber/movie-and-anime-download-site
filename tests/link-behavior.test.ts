import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { generateMigration } from "drizzle-kit/api";
import { linkBehavior } from "../src/lib/validation";
import type { DownloadLink } from "../src/lib/types";

// Execute the real component with injected React state so every branch renders.
function render(link: DownloadLink, { copyWebsite, outcome }: { copyWebsite?: string | null; outcome?: string } = {}) {
  const loaded = { exports: {} as Record<string, unknown> };
  const imports: Record<string, unknown> = {
    react: { ...React, useState: (initial: unknown) => [outcome ?? initial, () => {}] },
    "react/jsx-runtime": jsx,
    "@/lib/types": {},
    "@/lib/media-links": require("../src/lib/media-links"),
    "@/lib/copy-link": require("../src/lib/copy-link"),
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
    },
  );
  const Button = loaded.exports.default as React.ComponentType<{ link: DownloadLink; copyWebsite?: string | null }>;
  return renderToStaticMarkup(React.createElement(Button, { link, copyWebsite }));
}

const base: DownloadLink = {
  id: 7, mediaId: 1, seasonId: null, episodeId: null, label: "1080p", url: "https://pixeldrain.net/u/abc",
  fileSize: "1.2 GB", isUploaded: false, quality: "1080p", storageProvider: "external", objectKey: null,
  sizeBytes: null, linkBehavior: "open", afterCopyUrl: null,
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

const copyLink: DownloadLink = { ...base, linkBehavior: "copy" };

test("a Copy Link button opens its own website, else the saved default, else only copies", () => {
  const title = (html: string) => html.match(/title="([^"]*)"/)?.[1];
  assert.equal(title(render(copyLink, { copyWebsite: "https://www.default.example/tool" })), "External link — copy link, then open default.example");
  assert.equal(title(render({ ...copyLink, afterCopyUrl: "https://own.example/" }, { copyWebsite: "https://default.example/" })), "External link — copy link, then open own.example");
  assert.equal(title(render(copyLink)), "External link — copy link", "no website configured keeps Copy Only");
  assert.equal(title(render({ ...copyLink, afterCopyUrl: "javascript:alert(1)" })), "External link — copy link", "an unsafe saved value is ignored");
  assert.equal(title(render({ ...copyLink, afterCopyUrl: "javascript:alert(1)" }, { copyWebsite: "https://default.example/" })), "External link — copy link, then open default.example");
});

test("websites never apply to Open Link, stored files or other normal links", () => {
  const html = render({ ...base, afterCopyUrl: "https://own.example/" }, { copyWebsite: "https://default.example/" });
  assert.match(html, /<a href="https:\/\/pixeldrain\.net\/u\/abc"/);
  assert.doesNotMatch(html, /own\.example|default\.example/);
  const stored = render({ ...base, url: "r2:///videos/a.mp4", storageProvider: "r2", linkBehavior: "copy" }, { copyWebsite: "https://default.example/" });
  assert.match(stored, /href="\/api\/download\?id=7"/);
  assert.doesNotMatch(stored, /default\.example/);
});

test("each copy outcome tells the visitor what happened and never offers the website as the thing to copy", () => {
  const site = { copyWebsite: "https://www.site.example/downloader" };
  assert.match(render(copyLink, { ...site, outcome: "copied" }), /Link copied to clipboard\./);
  assert.match(render(copyLink, { ...site, outcome: "opened" }), /Link copied\. site\.example opened in a new tab/);
  const blocked = render(copyLink, { ...site, outcome: "blocked" });
  assert.match(blocked, /Your browser blocked the new tab/);
  assert.match(blocked, /<a href="https:\/\/www\.site\.example\/downloader" target="_blank" rel="noopener noreferrer"[^>]*>Open site\.example<\/a>/);
  const failed = render(copyLink, { ...site, outcome: "failed" });
  assert.match(failed, /Copy this link: <span class="select-all">https:\/\/pixeldrain\.net\/u\/abc<\/span>/, "the manual fallback shows the ORIGINAL link");
  assert.match(failed, /Open site\.example/);
  assert.doesNotMatch(render(copyLink, { outcome: "failed" }), /Open /, "no website, no Open link");
});

test("0010 only adds the nullable after_copy_url column, so existing rows and URLs are untouched", async () => {
  // Asserted from historical snapshots and files only, so later migrations cannot make it stale.
  const read = (file: string) => readFileSync(file, "utf8");
  const previous = JSON.parse(read("drizzle/meta/0009_snapshot.json")), saved = JSON.parse(read("drizzle/meta/0010_snapshot.json"));
  const ddl = (await generateMigration(previous, saved)).join("\n");
  assert.equal(ddl.trim(), 'ALTER TABLE "download_links" ADD COLUMN "after_copy_url" text;');
  assert.equal(read("drizzle/0010_link_copy_website.sql").trim(), ddl.trim());
  const column = saved.tables["public.download_links"].columns.after_copy_url;
  assert.deepEqual({ type: column.type, notNull: column.notNull, default: column.default }, { type: "text", notNull: false, default: undefined });
  for (const [name, table] of Object.entries(previous.tables) as [string, { columns: object }][]) {
    const next = saved.tables[name];
    if (name !== "public.download_links") assert.deepEqual(next, table, `${name} is unchanged`);
    else assert.deepEqual({ ...next.columns, after_copy_url: undefined }, { ...table.columns, after_copy_url: undefined }, "existing download_links columns are unchanged");
  }
  const journal = JSON.parse(read("drizzle/meta/_journal.json")).entries;
  const [prior, added] = [journal[9], journal[10]];
  assert.equal(added.tag, "0010_link_copy_website");
  assert.ok(added.when > prior.when, "drizzle-orm applies only entries newer than the last recorded migration");
  assert.equal(prior.tag, "0009_link_behavior", "0000-0009 stay as they were; 0010 is the only new migration");
});
