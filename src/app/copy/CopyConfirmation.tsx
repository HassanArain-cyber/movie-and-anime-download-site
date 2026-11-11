"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readCopyDestination } from "@/lib/copy-link";
import {
  COPY_CONFIRMATION_CHECKING, COPY_CONFIRMATION_FAILED, COPY_CONFIRMATION_INSTRUCTION,
  COPY_CONFIRMATION_MANUAL, COPY_CONFIRMATION_MISSING, COPY_CONFIRMATION_REDIRECT_MS,
  COPY_CONFIRMATION_SECONDS, COPY_CONFIRMATION_TICK_MS, COPY_CONFIRMATION_TITLE,
  copyConfirmationHost, copyConfirmationStatus,
} from "@/lib/copy-confirmation";

export type CopyConfirmationPhase = "checking" | "ready" | "failed" | "missing";

/** The visible card. Presentational, so the wording and the manual way out are testable alone. */
export function CopyConfirmationCard({ phase, website, seconds = COPY_CONFIRMATION_SECONDS, onContinue }: {
  phase: CopyConfirmationPhase;
  website: string | null;
  /** Whole seconds left on the countdown; the tab counts down from the full delay. */
  seconds?: number;
  onContinue: () => void;
}) {
  const host = copyConfirmationHost(website);
  return (
    <section aria-labelledby="copy-confirmation-title" data-testid="copy-confirmation" data-phase={phase} className="vault-copy-confirm">
      <span className="vault-copy-confirm-check" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="m4.5 12.5 5 5 10-11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h1 id="copy-confirmation-title" className="mt-5 text-balance text-2xl font-bold leading-tight text-white sm:text-3xl">{COPY_CONFIRMATION_TITLE}</h1>
      <p className="mt-3 text-balance text-sm leading-relaxed text-neutral-300 sm:text-base">{COPY_CONFIRMATION_INSTRUCTION}</p>

      {website ? (
        <>
          <p role="status" className="mt-5 break-words text-sm font-medium text-emerald-300 [overflow-wrap:anywhere]">
            {phase === "failed" ? COPY_CONFIRMATION_FAILED : copyConfirmationStatus(seconds)}
          </p>
          <button type="button" onClick={onContinue} className="vault-copy-confirm-continue">
            {COPY_CONFIRMATION_MANUAL}
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {host ? <p className="mt-3 break-words text-xs text-neutral-400 [overflow-wrap:anywhere]">Destination: {host}</p> : null}
        </>
      ) : (
        <p role="status" className="mt-5 text-sm text-amber-300">
          {phase === "checking" ? COPY_CONFIRMATION_CHECKING : COPY_CONFIRMATION_MISSING}
        </p>
      )}

      <Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center text-sm text-purple-300 underline">
        Back to Gojo’s Vault
      </Link>
    </section>
  );
}

const noopSubscribe = () => () => {};

/**
 * The destination is read from this tab's session storage, never from the URL, so
 * the address bar of the new tab stays clean and nothing is written to a log. The
 * tab then redirects itself to the saved website; the Continue button is the manual
 * way out when a browser refuses that navigation.
 */
export default function CopyConfirmation() {
  const website = useSyncExternalStore(noopSubscribe, readCopyDestination, () => null);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [failed, setFailed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const go = useCallback((destination: string) => {
    try {
      window.opener = null;
    } catch { /* nothing to detach */ }
    try {
      window.location.replace(destination);
    } catch {
      setFailed(true); // the Continue button retries from a fresh user gesture
    }
  }, []);
  // Count down on real elapsed time, not on how often the interval happens to fire, so a
  // throttled or busy tab still shows 5, 4, 3, 2, 1 and leaves on time.
  useEffect(() => {
    if (!hydrated || !website || failed) return;
    const startedAt = Date.now();
    const tick = () => {
      const left = Math.ceil((startedAt + COPY_CONFIRMATION_REDIRECT_MS - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        go(website);
        return;
      }
      setRemaining((current) => (current === left ? current : left));
    };
    const timer = setInterval(tick, COPY_CONFIRMATION_TICK_MS);
    return () => clearInterval(timer);
  }, [hydrated, website, failed, go]);
  const phase: CopyConfirmationPhase = !hydrated ? "checking" : failed ? "failed" : website ? "ready" : "missing";
  return (
    <div className="vault-copy-confirm-shell">
      <CopyConfirmationCard
        phase={phase}
        website={website}
        seconds={remaining ?? COPY_CONFIRMATION_SECONDS}
        onContinue={() => { if (website) go(website); }}
      />
    </div>
  );
}
