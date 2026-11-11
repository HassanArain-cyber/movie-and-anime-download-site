/** Browser-only helpers for Copy Link buttons (they need window, document and navigator). */

export type CopyOutcome =
  | "copied"  // copied; no website is configured
  | "opened"  // copied; a tab opened (the confirmation page, or the website once it is no longer shown)
  | "blocked" // copied, but the browser refused to open the new tab
  | "failed"; // could not copy; nothing was opened

/** Same-origin confirmation page shown in the new tab before the redirect. */
export const COPY_CONFIRM_PATH = "/copy";
/** Session key the opener leaves the destination in; it never becomes part of a URL. */
export const COPY_DESTINATION_KEY = "vault:copy-destination";
/** A destination older than this is ignored, so a reused tab can never redirect. */
export const COPY_DESTINATION_MAX_AGE_MS = 60_000;
/**
 * The confirmation is an introduction, not a permanent step: a browser sees it for its
 * first COPY_CONFIRM_LIMIT successful copies and then goes straight to the website.
 * Stored in localStorage so it is shared by every tab and survives a restart.
 */
export const COPY_CONFIRM_STORAGE_KEY = "vault:copy-confirmations";
const COPY_CONFIRM_LOCK = "vault:copy-confirmations-lock";
/** A reservation that could not be written: the page is shown, but nothing is remembered. */
export const UNTRACKED_CONFIRMATION = 0;
export const COPY_CONFIRM_LIMIT = 2;

/** Clipboard API first, then the legacy command for insecure contexts and in-app browsers. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* denied or unavailable: try the legacy path */ }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true; // avoids the on-screen keyboard
    field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length); // iOS ignores select() alone
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Only plain http(s) addresses can become a redirect target. */
function safeDestination(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Hand the destination to the tab that is about to open. A new tab started with
 * window.open() receives a copy of this session storage, so the address travels
 * out of the URL entirely: no query string, no history entry, no server log.
 * Returns false when the browser offers no storage; the caller then falls back
 * to opening the website directly, exactly as before.
 */
export function stageCopyDestination(website: string, now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(COPY_DESTINATION_KEY, JSON.stringify({ website, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Read the destination staged for this tab, ignoring stale or malformed values. */
export function readCopyDestination(now = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(COPY_DESTINATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { website?: unknown; at?: unknown };
    const website = safeDestination(parsed.website);
    const at = typeof parsed.at === "number" ? parsed.at : NaN;
    if (!website || !Number.isFinite(at) || now - at > COPY_DESTINATION_MAX_AGE_MS || at - now > COPY_DESTINATION_MAX_AGE_MS) {
      window.sessionStorage.removeItem(COPY_DESTINATION_KEY);
      return null;
    }
    return website;
  } catch {
    return null;
  }
}

/**
 * How many confirmation pages this browser has already been shown.
 *
 * Only a plain unsigned integer is accepted: "2" counts, while junk such as "2abc",
 * "1.9", "+3", " 2", "-1" or "Infinity" is treated as "nothing recorded yet" instead
 * of being loosely parsed into a wrong (or permanently full) count.
 */
export function confirmationsShown(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(COPY_CONFIRM_STORAGE_KEY);
    if (raw === null || !/^\d+$/.test(raw)) return 0;
    const count = Number(raw);
    return Number.isSafeInteger(count) && count > 0 ? Math.min(count, COPY_CONFIRM_LIMIT) : 0;
  } catch {
    return 0; // storage refused: act as if nothing was shown yet
  }
}

/** True while this browser still gets the confirmation page. */
export function shouldShowConfirmation(): boolean {
  return confirmationsShown() < COPY_CONFIRM_LIMIT;
}

/** Write the count, or drop the key when the browser has no confirmations left to record. */
function writeConfirmations(count: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (count <= 0) window.localStorage.removeItem(COPY_CONFIRM_STORAGE_KEY);
    else window.localStorage.setItem(COPY_CONFIRM_STORAGE_KEY, String(count));
    return true;
  } catch {
    return false; // storage refused or full: nothing to persist, the flow still works
  }
}

/**
 * Reserve-then-open keeps simultaneous tabs honest: the slot is claimed before the tab
 * opens, and the Web Locks API makes read-modify-write exclusive across every tab of
 * the profile. Without it the claim falls back to a verified write, and a tab that
 * loses the race simply skips the confirmation instead of showing a third.
 */
async function withConfirmationLock<T>(run: () => T): Promise<T | null> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") return run();
  try {
    return await locks.request(COPY_CONFIRM_LOCK, async () => run()) as T;
  } catch {
    return null; // a broken lock manager must never make the page exceed the limit
  }
}

/**
 * Claim one of the browser's confirmation slots. `null` means both are already used;
 * UNTRACKED_CONFIRMATION means storage is unusable, so the page is still shown but
 * nothing can be remembered (the pre-existing behaviour for such browsers).
 */
export async function reserveConfirmation(): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const claimed = await withConfirmationLock(() => {
    const shown = confirmationsShown();
    if (shown >= COPY_CONFIRM_LIMIT) return null;
    if (!writeConfirmations(shown + 1)) return UNTRACKED_CONFIRMATION;
    // Read back: with no lock another tab may have written between read and write.
    return confirmationsShown() === shown + 1 ? shown + 1 : null;
  });
  return typeof claimed === "number" ? claimed : null;
}

/** Hand a reserved slot back when the confirmation tab never opened. */
export async function releaseConfirmation(slot: number | null): Promise<void> {
  if (slot === null || slot <= UNTRACKED_CONFIRMATION || typeof window === "undefined") return;
  await withConfirmationLock(() => {
    // Only the reservation that is still on top can be given back: a later tab has
    // already claimed its own slot and must keep it.
    if (confirmationsShown() === slot) writeConfirmations(slot - 1);
    return null;
  });
}

/**
 * Copy the ORIGINAL download URL, then open the confirmation tab that tells the
 * visitor the link is ready and redirects itself to the website after a moment.
 *
 * Nothing opens unless the copy succeeded, and both calls happen inside the same
 * click so browsers still treat them as user-initiated. Never throws.
 */
export async function copyThenConfirm(downloadUrl: string, website: string | null): Promise<CopyOutcome> {
  if (!(await copyText(downloadUrl))) return "failed";
  if (!website) return "copied";
  // Only the first copies in a browser get the confirmation; later ones go straight to
  // the website. The slot is reserved first so two tabs clicking at once cannot both
  // show one more confirmation than the limit allows, and it is handed back whenever the
  // tab does not actually open.
  const slot = shouldShowConfirmation() ? await reserveConfirmation() : null;
  const confirm = slot !== null && stageCopyDestination(website);
  if (slot !== null && !confirm) await releaseConfirmation(slot); // no destination: give the slot back
  let tab: Window | null;
  try {
    // No "noopener" feature: it makes open() return null, hiding popup blockers.
    tab = window.open(confirm ? COPY_CONFIRM_PATH : website, "_blank");
  } catch {
    if (confirm) await releaseConfirmation(slot);
    return "blocked";
  }
  if (!tab || tab.closed) { // some blockers hand back an already closed window
    if (confirm) await releaseConfirmation(slot);
    return "blocked";
  }
  // Neither the confirmation page nor the site it redirects to needs this page.
  try { tab.opener = null; } catch { /* already cross-origin: nothing left to detach */ }
  return "opened";
}
