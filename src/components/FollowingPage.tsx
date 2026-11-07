"use client";
import Link from "next/link";
import PosterImage from "./PosterImage";
import FollowButton from "./FollowButton";
import { useState } from "react";
import { WATCH_STATUSES, type WatchStatus } from "@/lib/watch-status";
import { useUpdates } from "./UpdatesProvider";
export default function FollowingPage() {
  const { data, error, refresh } = useUpdates();
  const [filter, setFilter] = useState<WatchStatus | "all">("all");
  const titles = data?.following.filter((item) => filter === "all" || item.watchStatus === filter);
  return <div className="space-y-4">
    <div><p className="vault-eyebrow">YOUR LIBRARY</p><h1 className="mt-1 text-2xl font-bold text-white">Following</h1><p className="mt-2 text-sm text-neutral-400">Movies, anime and series saved in this browser. No login required.</p></div>
    <div role="group" aria-label="Filter by watch status" className="flex flex-wrap gap-1">
      {[{ value: "all" as const, label: "All" }, ...WATCH_STATUSES].map((status) => <button key={status.value} type="button" aria-pressed={filter === status.value} onClick={() => setFilter(status.value)} className={`min-h-9 rounded-md border px-2 py-1 text-xs ${filter === status.value ? "border-purple-500 bg-purple-500/15 text-purple-200" : "border-neutral-800 text-neutral-400"}`}>
        {status.label} ({data?.following.filter((item) => status.value === "all" || item.watchStatus === status.value).length ?? 0})
      </button>)}
    </div>
    <section aria-label="Followed titles" className="space-y-2">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">Followed titles {data ? `(${data.following.length})` : ""}</h2><button className="min-h-9 rounded-md px-2 text-xs text-purple-300 hover:bg-purple-500/10" onClick={() => void refresh()}>Refresh</button></div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!data && !error && <p className="text-sm text-neutral-400">Loading your follows…</p>}
      {data && !data.following.length && <div className="rounded-xl border border-dashed border-neutral-700 p-3 text-sm text-neutral-400">You are not following anything yet. <Link className="text-purple-300 underline" href="/movie">Browse movies</Link>, <Link className="text-purple-300 underline" href="/anime">anime</Link> or <Link className="text-purple-300 underline" href="/series">series</Link>, then select Follow on a title.</div>}
      {data && !!data.following.length && !titles?.length && <p role="status" className="rounded-lg border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">No titles with this status yet.</p>}
      <div className="grid gap-2 md:grid-cols-2">{titles?.map((item) => <article key={item.id} className="flex min-w-0 items-start gap-2.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5">
        <Link href={`/${item.type}/${item.slug}`} className="relative aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-md sm:w-16"><PosterImage src={item.posterUrl} title={item.title} sizes="(min-width: 640px) 64px, 56px" /></Link>
        <div className="min-w-0 flex-1 space-y-1.5"><Link href={`/${item.type}/${item.slug}`} className="block break-words text-sm font-semibold leading-snug text-white hover:text-purple-300">{item.title}</Link>
          {item.hasNew && <Link href="/notifications" className="inline-block rounded bg-purple-500/15 px-1.5 py-0.5 text-[11px] text-purple-200">New episodes</Link>}
          <FollowButton mediaId={item.id} mediaType={item.type} compact />
        </div>
      </article>)}</div>
    </section>
    <Link href="/notifications" className="inline-block text-sm text-purple-300">View notification history →</Link>
  </div>;
}
