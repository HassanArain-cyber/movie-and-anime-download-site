"use client";

import { useCallback, useEffect, useState } from "react";
import { COPY_TOAST_EVENT, COPY_TOAST_MS, copyToastText, type CopyToastDetail } from "@/lib/copy-toast";

/** The visible confirmation. Presentational: the container owns timing and state. */
export function CopyToastCard({ detail, onDismiss }: { detail: CopyToastDetail; onDismiss: () => void }) {
  return (
    <div
      data-testid="copy-toast"
      data-outcome={detail.outcome}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="vault-copy-toast"
    >
      <span className="vault-copy-toast-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="min-w-0 break-words text-sm leading-snug [overflow-wrap:anywhere]">
        {copyToastText(detail)}
        {detail.outcome === "blocked" && detail.website && (
          <>{" "}
            <a href={detail.website} target="_blank" rel="noopener noreferrer" className="font-medium text-purple-300 underline">Open {detail.host}</a>
          </>
        )}
      </span>
      <button type="button" aria-label="Dismiss copy confirmation" title="Dismiss" onClick={onDismiss} className="vault-copy-toast-dismiss">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
}

/**
 * Listens for successful Copy Link actions on any page and shows one toast at a
 * time. Nothing is rendered for a failed copy, and the polite live region exists
 * only while a confirmation does, so pages keep their own status announcements.
 */
export default function CopyToast() {
  const [detail, setDetail] = useState<CopyToastDetail | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const listen = (event: Event) => {
      const next = (event as CustomEvent<CopyToastDetail>).detail;
      if (!next || !next.outcome) return;
      // A fresh object restarts the dismiss timer for a repeated copy.
      setDetail({ ...next });
    };
    window.addEventListener(COPY_TOAST_EVENT, listen);
    return () => window.removeEventListener(COPY_TOAST_EVENT, listen);
  }, []);
  useEffect(() => {
    if (!detail || paused) return;
    const timer = setTimeout(() => setDetail(null), COPY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [detail, paused]);
  // Dismissing (or losing the toast) must never leave the timer paused: a touch
  // tap can otherwise fire pointerleave on an element that no longer exists.
  const close = useCallback(() => {
    setDetail(null);
    setPaused(false);
  }, []);
  return (
    <div
      className="vault-copy-toast-region"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setPaused(true); }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setPaused(false); }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {detail && <CopyToastCard detail={detail} onDismiss={close} />}
    </div>
  );
}
