/**
 * Browser-only plumbing for the Copy Link success toast.
 *
 * The toast is presentation only: it never performs the copy, never decides
 * whether a website opens and never stores anything. `DownloadButton` copies
 * first (see `copy-link.ts`) and then announces the outcome here.
 */

import type { CopyOutcome } from "./copy-link";

/** Outcomes worth confirming to the visitor. A failed copy keeps its inline fallback. */
export type CopyToastOutcome = Exclude<CopyOutcome, "failed">;

export type CopyToastDetail = {
  outcome: CopyToastOutcome;
  /** Host of the website that is opened after copying, when one is configured. */
  host: string;
  /** Same-origin-safe website address, used only by the blocked-tab fallback link. */
  website: string | null;
};

/** Event name on `window`; keeps the button and the toast independent. */
export const COPY_TOAST_EVENT = "vault:copy-toast";
/** How long a confirmation stays before it dismisses itself. */
export const COPY_TOAST_MS = 5000;

/**
 * What a finished copy should do: confirm the success with a toast, or keep the
 * inline manual-copy fallback. One place, so no surface can drift from another.
 */
export function copyOutcomeEffects(
  outcome: CopyOutcome,
  context: { host: string; website: string | null },
): { toast: CopyToastDetail | null; manualFallback: boolean } {
  if (outcome === "failed") return { toast: null, manualFallback: true };
  return { toast: { outcome, host: context.host, website: context.host ? context.website : null }, manualFallback: false };
}

/** Wording shared by the toast and its tests; the copy is already on the clipboard. */
export function copyToastText({ outcome, host }: CopyToastDetail): string {
  if (outcome === "copied") return "Link copied to clipboard.";
  if (outcome === "opened") return `Link copied. ${host} opened in a new tab — paste the link there.`;
  return `Link copied. Your browser blocked the new tab for ${host}.`;
}

/** Announce a successful Copy Link. Safe to call outside the browser (no-op). */
export function showCopyToast(detail: CopyToastDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CopyToastDetail>(COPY_TOAST_EVENT, { detail }));
}
