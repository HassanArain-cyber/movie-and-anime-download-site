/** Wording and timing for the Copy Link confirmation tab. Shared with the tests. */

export const COPY_CONFIRMATION_TITLE = "Link Copied Successfully!";
export const COPY_CONFIRMATION_INSTRUCTION = "Paste the copied link on the next website to download.";
export const COPY_CONFIRMATION_MANUAL = "Continue to download website";
export const COPY_CONFIRMATION_CHECKING = "Preparing your download…";
export const COPY_CONFIRMATION_FAILED = "Automatic redirection failed. Tap Continue to open the download website.";
export const COPY_CONFIRMATION_MISSING =
  "This tab could not read the download website. Return to the Vault page and tap Copy Link again.";
/** How long the confirmation stays before the tab redirects itself. */
export const COPY_CONFIRMATION_REDIRECT_MS = 5000;

export function copyConfirmationStatus(seconds: number = COPY_CONFIRMATION_REDIRECT_MS / 1000): string {
  return `Opening download website in ${seconds} ${seconds === 1 ? "second" : "seconds"}…`;
}

/** Readable host for the destination, without a leading "www.". */
export function copyConfirmationHost(website: string | null): string {
  if (!website) return "";
  try { return new URL(website).hostname.replace(/^www\./, ""); } catch { return ""; }
}
