"use client";

import { useState } from "react";
import type { DownloadLink } from "@/lib/types";
import { getLinkHref, getLinkProvider, getProviderLabel, getQuality, qualityDisplay } from "@/lib/media-links";

export default function DownloadButton({ link }: { link: DownloadLink }) {
  const href = getLinkHref(link);
  const provider = getLinkProvider(link);
  const stored = provider === "r2" || provider === "local";
  const quality = getQuality(link);
  const [message, setMessage] = useState("");
  // Copying needs a raw URL; stored files point at the download handler and keep
  // navigating. Everything else follows the admin's per-link choice.
  const copy = link.linkBehavior === "copy" && !stored && !!href;

  if (!href) {
    return <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 break-words rounded-md bg-neutral-900 px-3 py-2 text-sm text-neutral-500 ring-1 ring-neutral-800">Unavailable link</span>;
  }

  const className = "inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 break-words rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white ring-1 ring-neutral-700 transition hover:bg-violet-600 hover:ring-purple-600";
  const content = <>
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
    <span className="min-w-0 [overflow-wrap:anywhere]">{link.label || "Download"}</span>
    {quality && <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] uppercase">{qualityDisplay(quality)}</span>}
    {link.fileSize && <span className="min-w-0 text-xs text-neutral-400 [overflow-wrap:anywhere]">({link.fileSize})</span>}
    {provider === "telegram" && <span className="text-[10px] uppercase text-neutral-400">Telegram</span>}
    {copy && <span className="text-[10px] uppercase text-neutral-400">Copy</span>}
  </>;

  if (!copy) {
    return (
      <a
        href={href}
        {...(stored ? { download: "" } : { target: "_blank", rel: "noopener noreferrer" })}
        title={getProviderLabel(provider)}
        className={className}
      >
        {content}
      </a>
    );
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setMessage("Link copied to clipboard.");
    } catch {
      // Clipboard access is denied outside secure contexts or without permission.
      setMessage(`Could not copy automatically. Copy this link: ${href}`);
    }
  };

  return (
    <span className="inline-flex min-w-0 max-w-full flex-col gap-1">
      <button type="button" onClick={() => void copyUrl()} title={`${getProviderLabel(provider)} — copy link`} className={`${className} text-left`}>
        {content}
      </button>
      {message && <span role="status" className="break-words text-xs text-emerald-300 [overflow-wrap:anywhere]">{message}</span>}
    </span>
  );
}
