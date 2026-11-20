"use client";

import { useState } from "react";
import type { DownloadLink } from "@/lib/types";
import { getLinkHref, getLinkProvider, getProviderLabel, getQuality, qualityDisplay, safeWebsiteUrl, websiteHost } from "@/lib/media-links";
import { copyThenConfirm } from "@/lib/copy-link";
import { copyOutcomeEffects, showCopyToast } from "@/lib/copy-toast";

export default function DownloadButton({ link, copyWebsite, compact = false }: { link: DownloadLink; copyWebsite?: string | null; compact?: boolean }) {
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
    return <span className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-500">Unavailable link</span>;
  }

  const className = "group relative inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-xl border border-violet-300/25 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-700 px-4 py-2.5 text-center text-xs font-bold tracking-wide text-white shadow-[0_5px_20px_#7c3aed30] transition hover:from-violet-500 hover:via-purple-500 hover:to-fuchsia-600 hover:shadow-[0_8px_28px_#7c3aed50] active:scale-[.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 sm:w-auto sm:text-sm";
  const content = <>
    <svg className="h-[18px] w-[18px] shrink-0 transition-transform group-hover:translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
    <span className="min-w-0 [overflow-wrap:anywhere]">{copy ? "Copy link" : compact ? "Download" : (link.label || "Download")}</span>
    {!compact && quality && <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] uppercase">{qualityDisplay(quality)}</span>}
    {!compact && link.fileSize && <span className="min-w-0 text-xs text-neutral-400 [overflow-wrap:anywhere]">({link.fileSize})</span>}
    {!compact && provider === "telegram" && <span className="text-[10px] uppercase text-neutral-400">Telegram</span>}
    {!compact && copy && <span className="text-[10px] uppercase text-neutral-400">Copy</span>}
  </>;

  if (!copy) {
    return (
      <a
        href={href}
        {...(stored ? { download: "" } : { target: "_blank", rel: "noopener noreferrer" })}
        title={getProviderLabel(provider)}
        aria-label={link.label ? `${link.label} — Download` : "Download"}
        className={className}
      >
        {content}
      </a>
    );
  }

  // A real link, so it still works when the browser blocked the automatic tab.
  const openSite = website && <a href={website} target="_blank" rel="noopener noreferrer" className="font-medium underline">Open {host}</a>;

  return (
    <span className="inline-flex w-full min-w-0 max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={() => void copyThenConfirm(href, website).then((next) => {
          const effects = copyOutcomeEffects(next, { host, website });
          setFailure(effects.manualFallback ? "failed" : null);
          if (effects.toast) showCopyToast(effects.toast);
        })}
        title={`${getProviderLabel(provider)} — ${website ? `copy link, then continue to ${host}` : "copy link"}`}
        aria-label={link.label ? `${link.label} — Copy link` : "Copy link"}
        className={className}
      >
        {content}
      </button>
      {failure === "failed" && <span role="status" className="break-words text-xs text-amber-300 [overflow-wrap:anywhere]">
        Could not copy automatically. Copy this link: <span className="select-all">{href}</span> {openSite}
      </span>}
    </span>
  );
}
