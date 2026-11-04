"use client";

import type { DownloadLink } from "@/lib/types";
import { getLinkHref, getLinkProvider, getProviderLabel, getQuality, qualityDisplay } from "@/lib/media-links";

export default function DownloadButton({ link }: { link: DownloadLink }) {
  const href = getLinkHref(link);
  const provider = getLinkProvider(link);
  const stored = provider === "r2" || provider === "local";
  const quality = getQuality(link);

  if (!href) {
    return <span className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm text-neutral-500 ring-1 ring-neutral-800">Unavailable link</span>;
  }

  return (
    <a
      href={href}
      {...(stored ? { download: "" } : { target: "_blank", rel: "noopener noreferrer" })}
      title={getProviderLabel(provider)}
      className="inline-flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white ring-1 ring-neutral-700 transition hover:bg-violet-600 hover:ring-purple-600"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
      </svg>
      <span>{link.label || "Download"}</span>
      {quality && <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] uppercase">{qualityDisplay(quality)}</span>}
      {link.fileSize && <span className="text-xs text-neutral-400">({link.fileSize})</span>}
      {provider === "telegram" && <span className="text-[10px] uppercase text-neutral-400">Telegram</span>}
    </a>
  );
}
