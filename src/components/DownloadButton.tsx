"use client";

import { useState } from "react";
import type { DownloadLink } from "@/lib/types";
import { getLinkHref, getLinkProvider, getProviderLabel, getQuality, qualityDisplay, safeWebsiteUrl, websiteHost } from "@/lib/media-links";
import { copyThenOpen } from "@/lib/copy-link";
import { copyOutcomeEffects, showCopyToast } from "@/lib/copy-toast";

export default function DownloadButton({ link, copyWebsite }: { link: DownloadLink; copyWebsite?: string | null }) {
  const href = getLinkHref(link);
  const provider = getLinkProvider(link);
  const stored = provider === "r2" || provider === "local";
  const quality = getQuality(link);
  // Success is confirmed by the shared toast; only a failed copy keeps inline text
  // so the visitor can still select the URL by hand.
  const [failure, setFailure] = useState<"failed" | null>(null);
  // Copying needs a raw URL; stored files point at the download handler and keep
  // navigating. Everything else follows the admin's per-link choice.
  const copy = link.linkBehavior === "copy" && !stored && !!href;
  // The link's own website, else the saved site-wide default. None means copy only.
  const website = copy ? safeWebsiteUrl(link.afterCopyUrl) ?? safeWebsiteUrl(copyWebsite) : null;
  const host = website ? websiteHost(website) : "";

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

  // A real link, so it still works when the browser blocked the automatic tab.
  const openSite = website && <a href={website} target="_blank" rel="noopener noreferrer" className="font-medium underline">Open {host}</a>;

  return (
    <span className="inline-flex min-w-0 max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={() => void copyThenOpen(href, website).then((next) => {
          const effects = copyOutcomeEffects(next, { host, website });
          setFailure(effects.manualFallback ? "failed" : null);
          if (effects.toast) showCopyToast(effects.toast);
        })}
        title={`${getProviderLabel(provider)} — ${website ? `copy link, then open ${host}` : "copy link"}`}
        className={`${className} text-left`}
      >
        {content}
      </button>
      {failure === "failed" && <span role="status" className="break-words text-xs text-amber-300 [overflow-wrap:anywhere]">
        Could not copy automatically. Copy this link: <span className="select-all">{href}</span> {openSite}
      </span>}
    </span>
  );
}
