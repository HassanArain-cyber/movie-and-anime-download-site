/** Browser-only helpers for Copy Link buttons (they need window, document and navigator). */

export type CopyOutcome =
  | "copied"  // copied; no website is configured
  | "opened"  // copied, then the website opened in a new tab
  | "blocked" // copied, but the browser refused to open the new tab
  | "failed"; // could not copy; nothing was opened

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

/**
 * Copy the ORIGINAL download URL, then open the website that can use it.
 * The website is opened only after a successful copy, from the same click, so
 * browsers still count it as user-initiated. Never throws.
 */
export async function copyThenOpen(downloadUrl: string, website: string | null): Promise<CopyOutcome> {
  if (!(await copyText(downloadUrl))) return "failed";
  if (!website) return "copied";
  let tab: Window | null;
  try {
    // No "noopener" feature: it makes open() return null, hiding popup blockers.
    tab = window.open(website, "_blank");
  } catch {
    return "blocked";
  }
  if (!tab || tab.closed) return "blocked"; // some blockers hand back an already closed window
  // The opened site must not be able to script this page.
  try { tab.opener = null; } catch { /* already cross-origin: nothing left to detach */ }
  return "opened";
}
