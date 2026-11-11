import test from "node:test";
import assert from "node:assert/strict";
import {
  COPY_CONFIRM_LIMIT, COPY_CONFIRM_PATH, COPY_CONFIRM_STORAGE_KEY, COPY_DESTINATION_KEY,
  COPY_DESTINATION_MAX_AGE_MS, UNTRACKED_CONFIRMATION, confirmationsShown, copyThenConfirm,
  readCopyDestination, releaseConfirmation, reserveConfirmation, shouldShowConfirmation,
  stageCopyDestination,
} from "../src/lib/copy-link";
import { safeWebsiteUrl, websiteHost } from "../src/lib/media-links";
import { ApiError, websiteUrl } from "../src/lib/validation";

const DOWNLOAD = "https://www.terabox.com/s/1abc";
const SITE = "https://downloader.example/open";

type Fake = {
  clipboard?: "ok" | "denied" | "missing"; legacy?: boolean | "throws";
  open?: "tab" | "closed" | "blocked" | "throws";
  hold?: boolean; sealedTab?: boolean; storage?: boolean;
  /** localStorage: absent, throwing, or a working store shared by every call (one profile). */
  local?: "ok" | "missing" | "throws";
  /** Serialising Web Locks manager, the way a real browser keeps tabs of a profile in order. */
  locks?: boolean;
  /** Keeps every lock request pending until the test calls releaseLock() (a busy profile). */
  locksHeld?: boolean;
  /** What the opener's handle on the tab does when it must be sent to the website instead. */
  navigate?: "ok" | "throws";
};

/** Install fake browser globals for one scenario; `events` records what the code did, in order. */
function install(
  { clipboard = "ok", legacy = true, open = "tab", hold = false, sealedTab = false, storage = true, local = "ok", locks = false, locksHeld = false, navigate = "ok" }: Fake = {},
  profile = new Map<string, string>(),
  overrides: { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } } = {},
) {
  const events: string[] = [];
  const tab: { opener: unknown; closed?: boolean; location: { replace(url: string): void }; close(): void } = {
    opener: "the page",
    // The opener keeps a handle on the tab it created, so it can still send it elsewhere.
    location: { replace: (url: string) => {
      if (navigate === "throws") throw new DOMException("Navigation refused.", "SecurityError");
      events.push(`navigate:${url}`);
    } },
    close: () => { events.push("close"); tab.closed = true; },
  };
  if (open === "closed") tab.closed = true;
  if (sealedTab) Object.defineProperty(tab, "opener", { get: () => "the page", set: () => { throw new DOMException("cross-origin", "SecurityError"); } });
  const fields: { value: string; removed: boolean }[] = [];
  const stored = new Map<string, string>();
  let release = () => {};
  const gate = hold ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  // One queue per lock name: requests run strictly one after another, like the real API.
  let releaseLock = () => {};
  const lockGate = locksHeld ? new Promise<void>((resolve) => { releaseLock = resolve; }) : null;
  const lockQueues = new Map<string, Promise<unknown>>();
  const locksManager = {
    request: async (name: string, callback: () => unknown) => {
      await lockGate; // a contended lock: this tab waits for another tab to finish
      const queued = (lockQueues.get(name) ?? Promise.resolve()).then(() => callback());
      lockQueues.set(name, queued.then(() => undefined, () => undefined));
      return queued;
    },
  };
  const fakes: Record<string, unknown> = {
    navigator: {
      ...(clipboard === "missing" ? {} : { clipboard: { writeText: async (text: string) => {
        events.push(`copy:${text}`);
        await gate;
        if (clipboard === "denied") throw new DOMException("Write permission denied.", "NotAllowedError");
      } } }),
      ...(locks ? { locks: locksManager } : {}),
    },
    window: {
      open: (...args: unknown[]) => {
        events.push(`open:${args.join("|")}`);
        if (open === "throws") throw new Error("popup blocked");
        return open === "tab" || open === "closed" ? tab : null;
      },
      ...(storage ? { sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { events.push(`stage:${key}`); stored.set(key, value); },
        removeItem: (key: string) => { stored.delete(key); },
      } } : {}),
      // localStorage is the website-wide counter: it outlives tabs and restarts.
      ...(local === "missing" ? {} : { localStorage: overrides.localStorage ?? {
        getItem: (key: string) => {
          if (local === "throws") throw new DOMException("Storage is denied.", "SecurityError");
          return profile.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (local === "throws") throw new DOMException("Storage is denied.", "SecurityError");
          profile.set(key, value);
        },
        removeItem: (key: string) => { profile.delete(key); },
      } }),
    },
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
  return { events, tab, fields, stored, profile, release, releaseLock, restore };
}

async function run(fake: Fake, website: string | null = SITE, profile = new Map<string, string>()) {
  const env = install(fake, profile);
  try { return { outcome: await copyThenConfirm(DOWNLOAD, website), ...env }; } finally { env.restore(); }
}

/** The URL the code handed to window.open on that call. */
const openedUrl = (events: string[]) => (events.find((event) => event.startsWith("open:")) ?? "open:").slice(5).split("|")[0];
const stagedTwice = (events: string[]) => events.filter((event) => event.startsWith("stage:")).length;

test("copies the ORIGINAL download link, then opens the confirmation page instead of the website", async () => {
  const { outcome, events, tab, stored } = await run({});
  assert.equal(outcome, "opened");
  assert.deepEqual(events.filter((event) => !event.startsWith("stage:")), [`copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`]);
  assert.equal(events.filter((event) => event.startsWith("copy:") && event.includes("downloader.example")).length, 0, "the website is never what gets copied");
  assert.equal(tab.opener, null, "the confirmation tab cannot script the page");
  assert.deepEqual(JSON.parse(stored.get(COPY_DESTINATION_KEY) ?? "{}"), { website: SITE, at: JSON.parse(stored.get(COPY_DESTINATION_KEY) ?? "{}").at });
});

test("the new tab never receives the website or the download link through its URL", async () => {
  const { events } = await run({});
  const opened = events.find((event) => event.startsWith("open:")) ?? "";
  assert.equal(opened, `open:${COPY_CONFIRM_PATH}|_blank`, "a clean, static path: no query string, hash or encoded address");
  assert.doesNotMatch(opened, /terabox|downloader|https?:|\?|#/);
});

test("without a website it is the existing Copy Only behaviour", async () => {
  const { outcome, events } = await run({}, null);
  assert.equal(outcome, "copied");
  assert.deepEqual(events, [`copy:${DOWNLOAD}`], "no tab and nothing staged without a destination");
});

test("the confirmation page opens only after the copy has finished", async () => {
  const env = install({ hold: true });
  try {
    const pending = copyThenConfirm(DOWNLOAD, SITE);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(env.events, [`copy:${DOWNLOAD}`], "still copying: no tab yet, so nothing can race the clipboard");
    env.release();
    assert.equal(await pending, "opened");
    assert.deepEqual(env.events.filter((event) => !event.startsWith("stage:")), [`copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`]);
  } finally { env.restore(); }
});

test("a denied clipboard permission falls back to the legacy copy command and still continues", async () => {
  const { outcome, events, fields } = await run({ clipboard: "denied" });
  assert.equal(outcome, "opened");
  assert.deepEqual(events.filter((event) => !event.startsWith("stage:")), [`copy:${DOWNLOAD}`, "append", `legacy:copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`]);
  assert.equal(fields[0].value, DOWNLOAD);
  assert.equal(fields[0].removed, true, "the temporary field is cleaned up");
});

test("insecure pages without a clipboard API use the legacy copy command", async () => {
  const { outcome, events } = await run({ clipboard: "missing" }, null);
  assert.equal(outcome, "copied");
  assert.deepEqual(events, ["append", `legacy:copy:${DOWNLOAD}`]);
});

test("when nothing can copy, no confirmation page is shown and nothing is staged", async () => {
  for (const fake of [{ clipboard: "denied", legacy: false }, { clipboard: "missing", legacy: "throws" }] as Fake[]) {
    const { outcome, events } = await run(fake);
    assert.equal(outcome, "failed");
    assert.ok(!events.some((event) => event.startsWith("open:") || event.startsWith("stage:")), "no tab and no destination when the link was not copied");
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
  assert.equal(events.at(-1), `open:${COPY_CONFIRM_PATH}|_blank`);
  assert.doesNotMatch(events.join(), /noopener|noreferrer/);
});

test("without session storage the flow degrades to the previous behaviour instead of a dead end", async () => {
  const { outcome, events } = await run({ storage: false });
  assert.equal(outcome, "opened");
  assert.equal(events.at(-1), `open:${SITE}|_blank`, "no confirmation page: it could never learn the website");
});

test("the staged destination survives a round trip unmangled", () => {
  const env = install({});
  try {
    assert.equal(readCopyDestination(), null, "nothing staged yet");
    assert.equal(stageCopyDestination(`  ${SITE} `), true);
    assert.equal(readCopyDestination(), SITE, "stored trimmed and normalised");
  } finally { env.restore(); }
});

test("stale, tampered and unusable destinations are refused and dropped", () => {
  const env = install({});
  try {
    const now = Date.now();
    assert.equal(stageCopyDestination(SITE, now - COPY_DESTINATION_MAX_AGE_MS - 1), true);
    assert.equal(readCopyDestination(now), null, "an old destination must never redirect a reused tab");
    assert.equal(env.stored.has(COPY_DESTINATION_KEY), false, "and it is removed");

    stageCopyDestination(SITE, now + 10 * COPY_DESTINATION_MAX_AGE_MS);
    assert.equal(readCopyDestination(now), null, "a timestamp from the future is not trusted either");

    for (const bad of [{ website: "javascript:alert(1)" }, { website: "magnet:?xt=urn:btih:a" }, { website: 42 }, { at: 1 }, "not json"]) {
      env.stored.set(COPY_DESTINATION_KEY, typeof bad === "string" ? bad : JSON.stringify(bad));
      assert.equal(readCopyDestination(now), null, JSON.stringify(bad));
    }
  } finally { env.restore(); }
});

test("only the first two successful copies show the confirmation, then the website opens straight away", async () => {
  const profile = new Map<string, string>(); // one browser: shared by every tab and page
  const opened: string[] = [];
  for (let copy = 1; copy <= 5; copy += 1) {
    const { events, outcome, profile: after } = await run({}, SITE, profile);
    opened.push(openedUrl(events));
    assert.equal(outcome, "opened", `copy ${copy}`);
    assert.equal(after.get(COPY_CONFIRM_STORAGE_KEY), String(Math.min(copy, COPY_CONFIRM_LIMIT)), `copy ${copy} counts up to the limit, then stops`);
  }
  assert.deepEqual(opened, [COPY_CONFIRM_PATH, COPY_CONFIRM_PATH, SITE, SITE, SITE], "two confirmations, then the website itself");
});

test("nothing is staged for a copy that skips the confirmation", async () => {
  const profile = new Map<string, string>();
  const visits = [];
  for (let copy = 1; copy <= 3; copy += 1) {
    const { events } = await run({}, SITE, profile);
    visits.push(stagedTwice(events));
  }
  assert.deepEqual(visits, [1, 1, 0], "the destination is written for both confirmation tabs, and never for a direct open");
});

test("the limit is per browser, so it holds across pages, refreshes, new tabs and restarts", async () => {
  const profile = new Map<string, string>();
  await run({}, "https://downloader.example/anime-1", profile); // anime 1, first copy
  await run({}, "https://downloader.example/anime-1", profile); // the same page again
  // A different anime, then a refresh, then a fresh tab of a movie page, then a restarted browser:
  // every call reads the same localStorage, so all of them skip the confirmation.
  for (const site of ["https://downloader.example/anime-2", "https://downloader.example/anime-3", "https://downloader.example/movie-7"]) {
    const { events } = await run({}, site, profile);
    assert.equal(openedUrl(events), site, "the website opens immediately, on every other title too");
  }
  assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), "2", "and the count never moves past the limit");
  assert.equal(confirmationsShown(), 0, "outside a browser the counter is simply zero");
});

test("a blocked tab or a failed copy never spends one of the two confirmations", async () => {
  const profile = new Map<string, string>();
  for (const open of ["blocked", "closed", "throws"] as const) {
    const { outcome } = await run({ open }, SITE, profile);
    assert.equal(outcome, "blocked", open);
    assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, `a refused tab (${open}) is not a confirmation`);
  }
  for (const fake of [{ clipboard: "denied", legacy: false }, { clipboard: "missing", legacy: "throws" }] as Fake[]) {
    const { outcome } = await run(fake, SITE, profile);
    assert.equal(outcome, "failed");
    assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, "a failed copy is not a confirmation");
  }
  for (let copy = 1; copy <= COPY_CONFIRM_LIMIT; copy += 1) {
    const { events } = await run({}, SITE, profile);
    assert.equal(openedUrl(events), COPY_CONFIRM_PATH, "both confirmations are still available");
  }
  const { events } = await run({}, SITE, profile);
  assert.equal(openedUrl(events), SITE, "and only then does the website take over");
});

test("copy-only links never spend a confirmation", async () => {
  const profile = new Map<string, string>();
  for (let copy = 1; copy <= 3; copy += 1) {
    const { outcome } = await run({}, null, profile);
    assert.equal(outcome, "copied");
  }
  assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, "a link with no website has nothing to confirm");
  const { events } = await run({}, SITE, profile);
  assert.equal(openedUrl(events), COPY_CONFIRM_PATH, "so the first real website still gets its confirmation");
});

test("only a plain unsigned integer is read back; every other stored value counts as fresh", async () => {
  // Values a loose parseInt would have accepted, plus plain junk: all are "nothing recorded yet".
  const invalid = ["", " ", "2abc", "1.9", "+3", " 2", "2 ", "-3", "0x2", "1e1", "Infinity", "NaN", "true", "{}", "２"];
  for (const stored of invalid) {
    const profile = new Map([[COPY_CONFIRM_STORAGE_KEY, stored]]);
    const { events } = await run({}, SITE, profile);
    assert.equal(openedUrl(events), COPY_CONFIRM_PATH, `stored ${JSON.stringify(stored)} must not be trusted`);
  }
  // Real counts are still honoured: "1" leaves one confirmation, "2" or more is full.
  for (const [stored, expected] of [["0", COPY_CONFIRM_PATH], ["1", COPY_CONFIRM_PATH], ["2", SITE], ["7", SITE]] as [string, string][]) {
    const profile = new Map([[COPY_CONFIRM_STORAGE_KEY, stored]]);
    const { events } = await run({}, SITE, profile);
    assert.equal(openedUrl(events), expected, `stored ${JSON.stringify(stored)}`);
  }
});

test("a stored counter never reads above the limit", () => {
  const env = install({});
  try {
    const cases: [string, number][] = [["1", 1], ["2", COPY_CONFIRM_LIMIT], ["999999999999999", COPY_CONFIRM_LIMIT]];
    for (const [stored, expected] of cases) {
      env.profile.set(COPY_CONFIRM_STORAGE_KEY, stored);
      assert.equal(confirmationsShown(), expected, `stored ${stored}`);
    }
    env.profile.set(COPY_CONFIRM_STORAGE_KEY, "9007199254740993"); // beyond Number.MAX_SAFE_INTEGER
    assert.equal(confirmationsShown(), 0, "an unsafe integer is not a count");
  } finally { env.restore(); }
});

test("without usable storage the confirmation still works, it just cannot remember", async () => {
  for (const local of ["missing", "throws"] as const) {
    const profile = new Map<string, string>();
    for (let copy = 1; copy <= 3; copy += 1) {
      const { events, outcome } = await run({ local }, SITE, profile);
      assert.equal(outcome, "opened", local);
      assert.equal(openedUrl(events), COPY_CONFIRM_PATH, `${local}: no counter to consult, so every copy explains itself`);
    }
  }
});

test("the counter helpers read storage defensively", () => {
  // No window at all (server rendering): zero, never a throw.
  assert.equal(confirmationsShown(), 0);
  assert.equal(shouldShowConfirmation(), true);
  const env = install({});
  try {
    assert.equal(confirmationsShown(), 0, "a fresh browser starts at zero");
    assert.equal(shouldShowConfirmation(), true);
    env.profile.set(COPY_CONFIRM_STORAGE_KEY, String(COPY_CONFIRM_LIMIT));
    assert.equal(confirmationsShown(), COPY_CONFIRM_LIMIT);
    assert.equal(shouldShowConfirmation(), false, "at the limit the website opens directly");
  } finally { env.restore(); }
});

test("simultaneous tabs can never show more than two confirmations", async () => {
  const profile = new Map<string, string>();
  const env = install({ locks: true }, profile);
  try {
    // Four tabs clicking at the same moment. The choice has to be made synchronously (see the
    // user-activation tests), so all four open a tab; the profile-wide lock then decides which
    // two keep the confirmation, and the two losers are sent on to the website.
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => copyThenConfirm(DOWNLOAD, SITE)));
    assert.deepEqual(outcomes, ["opened", "opened", "opened", "opened"], "every click still copies and opens something");
    const confirmTabs = env.events.filter((event) => event === `open:${COPY_CONFIRM_PATH}|_blank`).length;
    const redirected = env.events.filter((event) => event === `navigate:${SITE}`).length;
    assert.equal(confirmTabs, 4, "four tabs were opened inside their own clicks");
    assert.equal(redirected, 2, "the two that lost the race were sent to the website");
    assert.equal(confirmTabs - redirected, COPY_CONFIRM_LIMIT, "exactly two confirmation pages stay on screen, never three");
    assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), String(COPY_CONFIRM_LIMIT));
  } finally { env.restore(); }
});

test("a tab that loses the race without the lock API is sent to the website instead of adding a confirmation", async () => {
  const store = new Map<string, string>();
  const env = install({}, store, {
    // Another tab writes the next count right after ours: the read-back must refuse to trust it.
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); if (value === "1") store.set(key, "2"); },
      removeItem: (key) => { store.delete(key); },
    },
  });
  try {
    assert.equal(await copyThenConfirm(DOWNLOAD, SITE), "opened");
    assert.deepEqual(env.events.filter((event) => !event.startsWith("stage:")), [
      `copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`, `navigate:${SITE}`,
    ], "the tab it already opened is sent to the website rather than showing a third confirmation");
    assert.equal(store.get(COPY_CONFIRM_STORAGE_KEY), "2", "and the count is left to the tabs that really showed it");
  } finally { env.restore(); }
});

test("a blocked tab gives its reserved slot back, so both confirmations stay available", async () => {
  const profile = new Map<string, string>();
  for (const open of ["blocked", "closed", "throws"] as const) {
    const env = install({ open, locks: true }, profile);
    try { assert.equal(await copyThenConfirm(DOWNLOAD, SITE), "blocked", open); } finally { env.restore(); }
    assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, `${open}: the reservation was released`);
  }
  const opened: string[] = [];
  for (let copy = 1; copy <= 3; copy += 1) {
    const env = install({ locks: true }, profile);
    try { await copyThenConfirm(DOWNLOAD, SITE); opened.push(openedUrl(env.events)); } finally { env.restore(); }
  }
  assert.deepEqual(opened, [COPY_CONFIRM_PATH, COPY_CONFIRM_PATH, SITE], "two confirmations are still there for the real copies");
});

test("giving a slot back never cancels a later tab's confirmation", async () => {
  const profile = new Map<string, string>();
  const tabA = install({ locks: true }, profile);
  const slotA = await reserveConfirmation();
  tabA.restore();
  const tabB = install({ locks: true }, profile);
  const slotB = await reserveConfirmation();
  tabB.restore();
  assert.deepEqual([slotA, slotB], [1, 2], "two tabs reserved the two slots");
  const release = install({ locks: true }, profile);
  await releaseConfirmation(slotA); // tab A was blocked after tab B had already claimed its slot
  release.restore();
  assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), "2", "tab B keeps the confirmation it already opened");
});

test("the tab is opened while the click is still active, before the profile lock is awaited", async () => {
  // Android Chrome and Safari drop the click's transient user activation as soon as an await
  // hops tasks, so anything awaited before window.open() can turn the tab into a blocked popup.
  // The profile-wide lock is deliberately busy here: the tab must open regardless.
  const profile = new Map<string, string>();
  const env = install({ locks: true, locksHeld: true }, profile);
  try {
    const pending = copyThenConfirm(DOWNLOAD, SITE);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(env.events.filter((event) => !event.startsWith("stage:")), [
      `copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`,
    ], "window.open() runs synchronously; a busy lock cannot delay it or spend the activation");
    assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, "the slot is claimed after the tab exists, not before");
    env.releaseLock();
    assert.equal(await pending, "opened");
    assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), "1", "and only then is the confirmation counted");
  } finally { env.restore(); }
});

test("a blocked tab does not spend the slot of a tab that opened", async () => {
  // Tab A is refused, then tab B really opens: the count must say 1, so the second
  // confirmation stays available. Reserving before the open would record A and leave only 2.
  const profile = new Map<string, string>();
  const tabA = install({ open: "blocked", locks: true }, profile);
  try { assert.equal(await copyThenConfirm(DOWNLOAD, SITE), "blocked"); } finally { tabA.restore(); }
  assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, "the refused tab was never counted");
  const tabB = install({ locks: true }, profile);
  try { assert.equal(await copyThenConfirm(DOWNLOAD, SITE), "opened"); } finally { tabB.restore(); }
  assert.equal(openedUrl(tabB.events), COPY_CONFIRM_PATH);
  assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), "1", "one confirmation opened, so one is recorded");
  const later = install({ locks: true }, profile);
  try { assert.equal(await copyThenConfirm(DOWNLOAD, SITE), "opened"); } finally { later.restore(); }
  assert.equal(openedUrl(later.events), COPY_CONFIRM_PATH, "the remaining confirmation is still available");
  assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), "2");
});

test("the stored count only ever matches the confirmation pages that really opened", async () => {
  const profile = new Map<string, string>();
  const steps = [
    { open: "blocked", count: null, url: null },
    { open: "throws", count: null, url: null },
    { open: "tab", count: "1", url: COPY_CONFIRM_PATH },
    { open: "blocked", count: "1", url: null },
    { open: "tab", count: "2", url: COPY_CONFIRM_PATH },
    { open: "tab", count: "2", url: SITE },
  ] as const;
  for (const [index, step] of steps.entries()) {
    const env = install({ open: step.open, locks: true }, profile);
    try { await copyThenConfirm(DOWNLOAD, SITE); } finally { env.restore(); }
    const where = `copy ${index + 1} (${step.open})`;
    assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY) ?? null, step.count, where);
    if (step.url) assert.equal(openedUrl(env.events), step.url, where);
  }
});

test("a tab that is gone before its confirmation could be seen hands the slot back", async () => {
  const profile = new Map<string, string>();
  const env = install({ locks: true, locksHeld: true }, profile);
  try {
    const pending = copyThenConfirm(DOWNLOAD, SITE);
    await new Promise((resolve) => setImmediate(resolve));
    env.tab.closed = true; // the browser (or the visitor) closed it while the lock was queued
    env.releaseLock();
    assert.equal(await pending, "blocked");
    assert.equal(profile.has(COPY_CONFIRM_STORAGE_KEY), false, "an unseen confirmation is not counted");
  } finally { env.restore(); }
});

test("a tab sent on to the website is closed when the browser refuses that redirect", async () => {
  for (const navigate of ["ok", "throws"] as const) {
    const profile = new Map<string, string>();
    const env = install({ locks: true, locksHeld: true, navigate }, profile);
    try {
      const pending = copyThenConfirm(DOWNLOAD, SITE);
      await new Promise((resolve) => setImmediate(resolve));
      // Two other tabs claimed both slots while this one was waiting for the lock.
      profile.set(COPY_CONFIRM_STORAGE_KEY, String(COPY_CONFIRM_LIMIT));
      env.releaseLock();
      assert.equal(await pending, "opened", navigate);
      assert.deepEqual(env.events.filter((event) => !event.startsWith("stage:")), navigate === "ok"
        ? [`copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`, `navigate:${SITE}`]
        : [`copy:${DOWNLOAD}`, `open:${COPY_CONFIRM_PATH}|_blank`, "close"],
      `${navigate}: the tab is never left on a confirmation it did not earn`);
      assert.equal(profile.get(COPY_CONFIRM_STORAGE_KEY), String(COPY_CONFIRM_LIMIT), `${navigate}: the count is untouched`);
    } finally { env.restore(); }
  }
});

test("reserving is skipped entirely when storage cannot record anything", async () => {
  const env = install({ local: "throws" });
  try {
    assert.equal(await reserveConfirmation(), UNTRACKED_CONFIRMATION, "the page is shown, but nothing is remembered");
    await releaseConfirmation(UNTRACKED_CONFIRMATION);
    assert.equal(env.profile.size, 0, "and releasing writes nothing either");
  } finally { env.restore(); }
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
