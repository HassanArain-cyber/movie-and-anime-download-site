"use client";

import { useState } from "react";
import Link from "next/link";
import type { LinkHealth } from "@/lib/link-health";

type CheckedLink = {
  id: number;
  mediaId: number | null;
  mediaTitle: string | null;
  mediaType: string | null;
  mediaHref: string | null;
  label: string | null;
  provider: string;
  status: LinkHealth;
  reason: string;
};

type AuditResponse = { links: CheckedLink[]; nextOffset: number | null; error?: string };

export default function LinkHealthManager({ onOpenMedia }: { onOpenMedia: () => void }) {
  const [links, setLinks] = useState<CheckedLink[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [running, setRunning] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);

  const audit = async (reset = false) => {
    if (running) return;
    const offset = reset ? 0 : nextOffset;
    if (offset === null) return;
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/admin/link-health?offset=" + offset, { cache: "no-store" });
      const data = await response.json() as AuditResponse;
      if (!response.ok) throw new Error(data.error || "Could not check download links.");
      setLinks((previous) => reset ? data.links : [...previous, ...data.links]);
      setNextOffset(data.nextOffset);
      setChecked(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not check download links.");
    } finally {
      setRunning(false);
    }
  };

  const issueCount = links.filter((link) => link.status === "broken").length;
  const unverifiedCount = links.filter((link) => link.status === "review").length;
  const visible = onlyIssues ? links.filter((link) => link.status !== "reachable") : links;

  return (
    <section aria-label="Download link health" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Download link checker</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">
            Checks R2 objects and external HTTPS links without downloading or changing files.
          </p>
        </div>
        <button type="button" disabled={running} onClick={() => void audit(true)}
          className="min-h-10 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-50">
          {running ? "Checking…" : checked ? "Check again" : "Check links"}
        </button>
      </div>

      <p className="text-xs text-neutral-400">
        Grey = unverified (some hosts block checks), not broken. Tap a result to open its title.
      </p>
      {checked && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
          <span>{links.length} checked</span>
          <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-rose-200">{issueCount} broken</span>
          <span className="rounded-lg bg-neutral-700/40 px-2 py-1 text-neutral-300">{unverifiedCount} unverified</span>
          <label className="ml-auto flex items-center gap-2">
            <input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} />
            Show issues only
          </label>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {checked && !links.length && <p className="text-sm text-neutral-400">No download links found.</p>}
      <div className="space-y-2">
        {visible.map((link) => {
          const card = (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-white">
                    {link.mediaTitle || "Media item"} · {link.label || "Download"}
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-400">Link #{link.id} · {link.provider}</p>
                </div>
                <span className={"rounded-lg px-2 py-1 text-[11px] font-semibold " +
                  (link.status === "broken" ? "bg-rose-500/15 text-rose-200" :
                    link.status === "reachable" ? "bg-emerald-500/15 text-emerald-200" :
                      "bg-neutral-700/40 text-neutral-300")}>
                  {link.status === "broken" ? "Broken" : link.status === "reachable" ? "Responded" : "Unverified"}
                </span>
              </div>
              <p className="mt-1.5 break-words text-xs text-neutral-400">{link.reason}</p>
              {link.mediaHref && (
                <p className="mt-2 text-xs font-semibold text-violet-300">
                  Open {link.mediaType === "anime" ? "anime" : link.mediaType === "series" ? "series" : "movie"} page ↗
                </p>
              )}
            </>
          );
          const className = "block rounded-xl border border-white/10 bg-neutral-900/60 p-3";
          return link.mediaHref ? (
            <Link key={link.id} href={link.mediaHref}
              aria-label={"Open " + (link.mediaTitle || "media item") + " to review download link " + link.id}
              className={className + " transition hover:border-violet-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"}>
              {card}
            </Link>
          ) : (
            <article key={link.id} className={className}>{card}</article>
          );
        })}
      </div>
      {nextOffset !== null && checked && (
        <button type="button" disabled={running} onClick={() => void audit()}
          className="min-h-10 rounded-lg border border-neutral-700 px-3 text-xs font-semibold text-neutral-200 disabled:opacity-50">
          {running ? "Checking…" : "Check next links"}
        </button>
      )}
      <button type="button" onClick={onOpenMedia} className="min-h-10 rounded-lg border border-purple-400/30 px-3 text-xs font-semibold text-purple-200">
        Open Media to edit links
      </button>
    </section>
  );
}
