import test from "node:test";
import assert from "node:assert/strict";
import { copyThenOpen } from "../src/lib/copy-link";
import { safeWebsiteUrl, websiteHost } from "../src/lib/media-links";
import { ApiError, websiteUrl } from "../src/lib/validation";

const DOWNLOAD = "https://www.terabox.com/s/1abc";
const SITE = "https://downloader.example/open";

type Fake = { clipboard?: "ok" | "denied" | "missing"; legacy?: boolean | "throws"; open?: "tab" | "closed" | "blocked" | "throws"; hold?: boolean; sealedTab?: boolean };

/** Install fake browser globals for one scenario; `events` records what the code did, in order. */
function install({ clipboard = "ok", legacy = true, open = "tab", hold = false, sealedTab = false }: Fake = {}) {
  const events: string[] = [];
  const tab: { opener: unknown; closed?: boolean } = { opener: "the page" };
  if (open === "closed") tab.closed = true;
  if (sealedTab) Object.defineProperty(tab, "opener", { get: () => "the page", set: () => { throw new DOMException("cross-origin", "SecurityError"); } });
  const fields: { value: string; removed: boolean }[] = [];
  let release = () => {};
  const gate = hold ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  const fakes: Record<string, unknown> = {
    navigator: clipboard === "missing" ? {} : { clipboard: { writeText: async (text: string) => {
      events.push(`copy:${text}`);
      await gate;
      if (clipboard === "denied") throw new DOMException("Write permission denied.", "NotAllowedError");
    } } },
    window: { open: (...args: unknown[]) => {
      events.push(`open:${args.join("|")}`);
      if (open === "throws") throw new Error("popup blocked");
      return open === "tab" || open === "closed" ? tab : null;
    } },
    document: {
      body: { appendChild: () => events.push("append") },
      createElement: () => {
        const field = { value: "", removed: false, readOnly: false, style: {} as Record<string, string>, select: () => {}, setSelectionRange: () => {}, remove: () => { field.removed = true; } };
        fields.push(field);
        return field;
      },
      execCommand: (command: string) => {
        events.push(`legacy:${command}:${fields.at(-1)?.value}`);
        if (legacy === "throws") throw new Error("not supported");
        return legacy;
      },
    },
  };
  const original = Object.keys(fakes).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(fakes)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const restore = () => { for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; } };
  return { events, tab, fields, release, restore };
}

async function run(fake: Fake, website: string | null = SITE) {
  const env = install(fake);
  try { return { outcome: await copyThenOpen(DOWNLOAD, website), ...env }; } finally { env.restore(); }
}

test("copies the ORIGINAL download link, then opens only the configured website", async () => {
  const { outcome, events, tab } = await run({});
  assert.equal(outcome, "opened");
  assert.deepEqual(events, [`copy:${DOWNLOAD}`, `open:${SITE}|_blank`]);
  assert.equal(events.filter((event) => event.startsWith("copy:") && event.includes("downloader.example")).length, 0, "the website is never what gets copied");
  assert.equal(tab.opener, null, "the opened site cannot script the page");
});

test("without a website it is the existing Copy Only behaviour", async () => {
  const { outcome, events } = await run({}, null);
  assert.equal(outcome, "copied");
  assert.deepEqual(events, [`copy:${DOWNLOAD}`]);
});

test("the website opens only after the copy has finished", async () => {
  const env = install({ hold: true });
  try {
    const pending = copyThenOpen(DOWNLOAD, SITE);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(env.events, [`copy:${DOWNLOAD}`], "still copying: nothing is opened yet");
    env.release();
    assert.equal(await pending, "opened");
    assert.equal(env.events.length, 2);
  } finally { env.restore(); }
});

test("a denied clipboard permission falls back to the legacy copy command and still continues", async () => {
  const { outcome, events, fields } = await run({ clipboard: "denied" });
  assert.equal(outcome, "opened");
  assert.deepEqual(events, [`copy:${DOWNLOAD}`, "append", `legacy:copy:${DOWNLOAD}`, `open:${SITE}|_blank`]);
  assert.equal(fields[0].value, DOWNLOAD);
  assert.equal(fields[0].removed, true, "the temporary field is cleaned up");
});

test("insecure pages without a clipboard API use the legacy copy command", async () => {
  const { outcome, events } = await run({ clipboard: "missing" }, null);
  assert.equal(outcome, "copied");
  assert.deepEqual(events, ["append", `legacy:copy:${DOWNLOAD}`]);
});

test("when nothing can copy, the website is NOT opened and the visitor gets the manual fallback", async () => {
  for (const fake of [{ clipboard: "denied", legacy: false }, { clipboard: "missing", legacy: "throws" }] as Fake[]) {
    const { outcome, events } = await run(fake);
    assert.equal(outcome, "failed");
    assert.ok(!events.some((event) => event.startsWith("open:")), "no tab opens when the link was not copied");
  }
});

test("a popup blocker is reported after a successful copy instead of failing silently", async () => {
  for (const open of ["blocked", "closed", "throws"] as const) {
    const { outcome, events } = await run({ open });
    assert.equal(outcome, "blocked", open);
    assert.equal(events[0], `copy:${DOWNLOAD}`, "the link was still copied");
  }
});

test("a tab that is already cross-origin and cannot be detached still counts as opened", async () => {
  const { outcome } = await run({ sealedTab: true });
  assert.equal(outcome, "opened", "the tab did open; only the opener cleanup is skipped");
});

test("open() is called without noopener, which would hide popup blockers by always returning null", async () => {
  const { events } = await run({});
  assert.equal(events.at(-1), `open:${SITE}|_blank`);
  assert.doesNotMatch(events.join(), /noopener|noreferrer/);
});

test("only plain http(s) websites are usable", () => {
  for (const good of ["https://terabox-downloader.example", " http://a.example/path?q=1 ", "https://sub.a.example:8443/x#y"]) assert.equal(safeWebsiteUrl(good), good.trim());
  for (const bad of ["", "   ", null, undefined, "javascript:alert(1)", "data:text/html,x", "ftp://a.example", "magnet:?xt=urn:btih:a", "tg://resolve?domain=x", "//a.example", "a.example", "https://", "https://user:pw@a.example/", "https://a b.example"]) {
    assert.equal(safeWebsiteUrl(bad), null, String(bad));
  }
  assert.equal(websiteHost("https://www.terabox.example/s/1"), "terabox.example");
});

test("the admin website field: blank means none, a valid address is trimmed, anything else is a 400", () => {
  for (const blank of [undefined, null, "", "   "]) assert.equal(websiteUrl(blank), null);
  assert.equal(websiteUrl("  https://a.example/x  "), "https://a.example/x");
  for (const bad of ["javascript:alert(1)", "a.example", "ftp://a.example", "https://u:p@a.example", 42, {}, `https://a.example/${"x".repeat(2048)}`]) {
    assert.throws(() => websiteUrl(bad), (error: unknown) => error instanceof ApiError && error.status === 400, String(bad));
  }
});
