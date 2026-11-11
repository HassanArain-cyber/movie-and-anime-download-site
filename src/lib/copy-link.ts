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

/** How many confirmation pages this browser has already been shown (0 when unknown). */
export function confirmationsShown(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(COPY_CONFIRM_STORAGE_KEY);
    if (!raw) return 0;
    const count = Number.parseInt(raw, 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0; // storage refused: act as if nothing was shown yet
  }
}

/** True while this browser still gets the confirmation page. */
export function shouldShowConfirmation(): boolean {
  return confirmationsShown() < COPY_CONFIRM_LIMIT;
}

/** Called only once a confirmation tab has really opened, so refusals never count. */
function recordConfirmation(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COPY_CONFIRM_STORAGE_KEY, String(confirmationsShown() + 1));
  } catch { /* storage refused or full: nothing to persist, the flow still works */ }
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
  // the website. Without session storage the confirmation page could not learn the
  // website either, so that case keeps the previous behaviour instead of a dead end.
  const confirm = shouldShowConfirmation() && stageCopyDestination(website);
  let tab: Window | null;
  try {
    // No "noopener" feature: it makes open() return null, hiding popup blockers.
    tab = window.open(confirm ? COPY_CONFIRM_PATH : website, "_blank");
  } catch {
    return "blocked";
  }
  if (!tab || tab.closed) return "blocked"; // some blockers hand back an already closed window
  if (confirm) recordConfirmation(); // only a confirmation that really opened is counted
  // Neither the confirmation page nor the site it redirects to needs this page.
  try { tab.opener = null; } catch { /* already cross-origin: nothing left to detach */ }
  return "opened";
}
