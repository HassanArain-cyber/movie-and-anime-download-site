"use client";

import { useState } from "react";
import { SITE_ORIGIN } from "@/lib/seo";

/** Share only the public title URL, never admin or session information. */
export default function ShareButton({ title }: { title: string }) {
  const [message, setMessage] = useState("");

  const share = async () => {
    // Always share the public canonical domain, never a login-protected Vercel Preview URL.
    const url = SITE_ORIGIN + window.location.pathname;
    setMessage("");

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Closing the phone's native share sheet is not an error.
        if ((error as Error).name === "AbortError") return;
      }
    }

    // Desktop browsers may not have a native share sheet.
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied");
    } catch {
      setMessage("Copy failed");
    }
  };

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button type="button" onClick={() => void share()}
        aria-label={"Share " + title} title="Share"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-700 text-neutral-200 transition hover:border-purple-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.7 10.5 6.6-4M8.7 13.5l6.6 4" />
        </svg>
      </button>
      {message && (
        <span role="status" className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-white shadow-lg">
          {message}
        </span>
      )}
    </span>
  );
}
