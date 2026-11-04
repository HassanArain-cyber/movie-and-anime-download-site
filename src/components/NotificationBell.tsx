"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useUpdates, type EpisodeNotification } from "./UpdatesProvider";
export function NotificationItem({ item, onOpen }: { item: EpisodeNotification; onOpen?: () => void }) {
  const { markRead } = useUpdates();
  return <Link href={item.url} onClick={() => { onOpen?.(); void markRead(item.id).catch(() => undefined); }} className={`block min-w-0 rounded-lg p-3 text-sm hover:bg-white/5 ${item.readAt ? "text-neutral-400" : "bg-purple-500/10 text-neutral-100"}`}>
    <span className="block break-words font-semibold">{!item.readAt && <span className="mr-2 text-purple-300" aria-label="Unread">●</span>}{item.title}</span>
    <span className="mt-1 block break-words text-xs">Season {item.seasonNumber} · Episode {item.episodeNumber}{item.episodeTitle ? ` — ${item.episodeTitle}` : ""}</span>
    <time dateTime={item.createdAt} className="mt-1 block text-xs text-neutral-500">{new Date(item.createdAt).toLocaleString()}</time>
  </Link>;
}
export default function NotificationBell() {
  const { data, error, markRead, refresh } = useUpdates();
  const [message, setMessage] = useState("");
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <details ref={ref} className="shrink-0" onKeyDown={(e) => { if (e.key === "Escape" && ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } }}>
    <summary aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} className="relative flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-neutral-800 text-neutral-200 hover:border-purple-400">
      <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {!!data?.unread && <span className="absolute -right-1 -top-1 rounded-full bg-purple-600 px-1.5 text-[10px] font-bold text-white" aria-hidden="true">{data.unread > 99 ? "99+" : data.unread}</span>}
    </summary>
    <section aria-label="Recent notifications" className="fixed right-4 top-20 z-50 max-h-[75dvh] w-[calc(100vw-2rem)] max-w-sm overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 p-2"><h2 className="font-semibold text-white">Notifications</h2>{!!data?.unread && <button className="min-h-9 text-xs text-purple-300" onClick={() => { void markRead().catch((e: Error) => setMessage(e.message)); }}>Mark all read</button>}</div>
      {(error || message) && <p role="alert" className="p-2 text-xs text-red-300">{error || message} <button className="underline" onClick={() => void refresh()}>Retry</button></p>}
      {!data && !error && <p className="p-3 text-sm text-neutral-400">Loading…</p>}
      {data && !data.notifications.length && <p className="p-3 text-sm text-neutral-400">No episode alerts yet. Follow an anime or series to get started.</p>}
      <div className="space-y-1">{data?.notifications.slice(0, 6).map((item) => <NotificationItem key={item.id} item={item} onOpen={() => { if (ref.current) ref.current.open = false; }} />)}</div>
      <div className="mt-2 flex flex-wrap gap-4 border-t border-neutral-800 p-2 text-xs text-purple-300"><Link href="/notifications" onClick={() => { if (ref.current) ref.current.open = false; }}>All notifications</Link><Link href="/following" onClick={() => { if (ref.current) ref.current.open = false; }}>Following &amp; preferences</Link></div>
    </section>
  </details>;
}
