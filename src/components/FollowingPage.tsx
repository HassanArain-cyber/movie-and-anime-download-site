"use client";
import Link from "next/link";
import PosterImage from "./PosterImage";
import FollowButton from "./FollowButton";
import LibraryBackup from "./LibraryBackup";
import { useEffect, useRef, useState } from "react";
import { WATCH_STATUSES, type WatchStatus } from "@/lib/watch-status";
import { useUpdates } from "./UpdatesProvider";
import { useCalendarFollows } from "./useCalendarFollows";
import { updateCalendarFollow } from "@/lib/calendar-follows";
type NextAiring = { anilistId: number; episode: number; airingAt: string; totalEpisodes: number | null };
function timeUntil(date: string, now: number) {
  const time = Date.parse(date) - now;
  if (time <= 0) return "Airing now";
  const hours = Math.floor(time / 3600000);
  const minutes = Math.floor((time % 3600000) / 60000);
  return hours >= 24 ? Math.floor(hours / 24) + "d " + (hours % 24) + "h" : hours ? hours + "h " + minutes + "m" : minutes + "m";
}
export default function FollowingPage() {
  const { data, error, refresh } = useUpdates();
  const calendarFollows = useCalendarFollows();
  const [calendarError, setCalendarError] = useState("");
  const calendarOnly = calendarFollows.filter((entry) => !(
    entry.source === "anilist" && data?.following.some((item) =>
      item.externalSource === "anilist" && item.externalId === String(entry.externalId))
  ));
  const [filter, setFilter] = useState<WatchStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [airings, setAirings] = useState<Record<string, NextAiring>>({});
  const [clock, setClock] = useState(() => Date.now());
  const followedIds = [...new Set([...(data?.following ?? []).filter((item) => item.externalSource === "anilist" && /^\d+$/.test(item.externalId || "")).map((item) => item.externalId!), ...calendarOnly.filter((item) => item.source === "anilist").map((item) => String(item.externalId))])].slice(0, 35).join(",");
  useEffect(() => {
    if (!followedIds) return;
    const controller = new AbortController();
    fetch("/api/next-airings?ids=" + encodeURIComponent(followedIds), { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { airings?: NextAiring[] } | null) => {
        if (controller.signal.aborted || !body?.airings) return;
        setAirings(Object.fromEntries(body.airings.map((item) => [String(item.anilistId), item])));
      }).catch(() => undefined);
    return () => controller.abort();
  }, [followedIds]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const filterRoot = useRef<HTMLDivElement>(null);
  const filterToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterRoot.current?.contains(event.target)) setFilterOpen(false);
    };
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFilterOpen(false); filterToggle.current?.focus(); }
    };
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKeyboard);
    return () => { document.removeEventListener("pointerdown", handlePointer); document.removeEventListener("keydown", handleKeyboard); };
  }, [filterOpen]);
  const choices: { value: WatchStatus | "all"; label: string }[] = [
    { value: "all", label: "All" },
    ...WATCH_STATUSES.map((status) => ({
      value: status.value,
      label: status.value === "continue" ? "Ongoing" : status.label,
    })),
  ];
  const active = choices.find((choice) => choice.value === filter)!;
  const countFor = (status: WatchStatus | "all") =>
    data?.following.filter((item) => status === "all" || item.watchStatus === status).length ?? 0;
  const titles = data?.following.filter((item) => filter === "all" || item.watchStatus === filter);
  return <div className="space-y-4">
    <div><p className="vault-eyebrow">YOUR LIBRARY</p><h1 className="mt-1 text-2xl font-bold text-white">Following</h1><p className="mt-2 text-sm text-neutral-400">Movies, anime and series saved in this browser. No login required.</p></div>
    <LibraryBackup followedTitles={data?.following ?? null} refreshFollows={refresh} />
    <div ref={filterRoot} role="group" aria-label="Filter by watch status" className="relative w-full max-w-xs">
      <button ref={filterToggle} type="button" aria-label="Watch status filter" aria-haspopup="true"
        aria-expanded={filterOpen} aria-controls="vault-watch-status-options"
        onClick={() => setFilterOpen((open) => !open)}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-violet-400/30 bg-gradient-to-r from-[#21172f] to-[#15121f] px-3.5 py-2.5 text-left shadow-[0_6px_24px_#00000025] transition hover:border-violet-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-purple-400/15 bg-violet-500/15 text-purple-200">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M7 12h10m-7 5h4" /><path d="m17 16 2 2 3-4" /></svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Watch status</span>
          <span className="block truncate text-sm font-bold text-white">{active.label} <span className="font-medium text-purple-300">({countFor(filter)})</span></span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-purple-300 transition-transform duration-200 ${filterOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 9 7 7 7-7" /></svg>
      </button>
      {filterOpen && <div id="vault-watch-status-options" className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 overflow-hidden rounded-2xl border border-purple-400/25 bg-[#15111f] p-1.5 shadow-[0_18px_50px_#000000a8]">
        <p className="px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[.16em] text-neutral-500">Filter your list</p>
        {choices.map((choice) => {
          const selected = filter === choice.value;
          return <button type="button" key={choice.value} aria-label={`${choice.label} (${countFor(choice.value)})`} aria-pressed={selected}
            onClick={() => { setFilter(choice.value); setFilterOpen(false); filterToggle.current?.focus(); }}
            className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${selected ? "bg-violet-600/25 text-purple-100" : "text-neutral-300 hover:bg-white/[.06]"}`}>
            <span className="min-w-0 flex-1 font-semibold">{choice.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${selected ? "bg-violet-400/20 text-purple-100" : "bg-white/[.06] text-neutral-400"}`}>{countFor(choice.value)}</span>
            <span aria-hidden="true" className="w-4 text-purple-300">{selected ? "✓" : ""}</span>
          </button>;
        })}
      </div>}
    </div>
    <section aria-label="Followed titles" className="space-y-2">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">Followed titles {data ? `(${data.following.length})` : ""}</h2><button className="min-h-9 rounded-md px-2 text-xs text-purple-300 hover:bg-purple-500/10" onClick={() => void refresh()}>Refresh</button></div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!data && !error && <p className="text-sm text-neutral-400">Loading your follows…</p>}
      {data && !data.following.length && !calendarOnly.length && <div className="rounded-xl border border-dashed border-neutral-700 p-3 text-sm text-neutral-400">You are not following anything yet. <Link className="text-purple-300 underline" href="/movie">Browse movies</Link>, <Link className="text-purple-300 underline" href="/anime">anime</Link> or <Link className="text-purple-300 underline" href="/series">series</Link>, then select Follow on a title.</div>}
      {data && !!data.following.length && !titles?.length && <p role="status" className="rounded-lg border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">No titles with this status yet.</p>}
      <div className="grid gap-2 md:grid-cols-2">{titles?.map((item) => <article key={item.id} className="flex min-w-0 items-start gap-2.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5">
        <Link href={`/${item.type}/${item.slug}`} className="relative aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-md sm:w-16"><PosterImage src={item.posterUrl} title={item.title} sizes="(min-width: 640px) 64px, 56px" /></Link>
        <div className="min-w-0 flex-1 space-y-1.5"><Link href={`/${item.type}/${item.slug}`} className="block break-words text-sm font-semibold leading-snug text-white hover:text-purple-300">{item.title}</Link>
          {item.hasNew && <Link href="/notifications" className="inline-block rounded bg-purple-500/15 px-1.5 py-0.5 text-[11px] text-purple-200">New episodes</Link>}
          {item.externalSource === "anilist" && item.externalId && airings[item.externalId] && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[.07] px-2.5 py-1.5 text-[11px] text-emerald-200">
              <p className="font-semibold">Next: Episode {airings[item.externalId].episode} · {timeUntil(airings[item.externalId].airingAt, clock)}</p>
              <time dateTime={airings[item.externalId].airingAt} className="text-emerald-100/65">{new Date(airings[item.externalId].airingAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })} PKT</time>
            </div>
          )}
          <FollowButton mediaId={item.id} mediaType={item.type} compact />
        </div>
      </article>)}</div>
    </section>
    {calendarOnly.length > 0 && (
      <section aria-label="Calendar follows" className="space-y-3 rounded-2xl border border-sky-500/20 bg-[#0a1726] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-base font-bold text-white">Calendar anime ({calendarOnly.length})</h2>
            <p className="mt-1 text-xs text-slate-400">Followed from release schedules · saved on this device.</p></div>
          <Link href="/calendar" className="rounded-lg border border-sky-500/25 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/10">Open calendar</Link>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">These follow the airing calendar. A release date does not mean the episode is uploaded to Vault; Vault upload alerts require following a title on Vault.</p>
        {calendarError && <p role="alert" className="text-xs text-rose-300">{calendarError}</p>}
        <div className="grid gap-2 md:grid-cols-2">{calendarOnly.map((item) => {
          const airing = item.source === "anilist" ? airings[String(item.externalId)] : null;
          const href = item.source === "anilist" ? "https://anilist.co/anime/" + item.externalId : "https://myanimelist.net/anime/" + item.externalId;
          return <article key={item.source + ":" + item.externalId} className="flex min-w-0 items-start gap-3 rounded-xl border border-white/10 bg-white/[.03] p-2.5">
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={"View " + item.title + " on anime database"}
              className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-900">
              <PosterImage src={item.posterUrl} title={item.title} sizes="56px" className="object-cover" />
            </a>
            <div className="min-w-0 flex-1 space-y-1.5">
              <a href={href} target="_blank" rel="noopener noreferrer" className="block break-words text-sm font-semibold leading-snug text-white hover:text-sky-200">{item.title}</a>
              {airing && <p className="text-[11px] font-medium text-emerald-200">Next: Episode {airing.episode} · {timeUntil(airing.airingAt, clock)}</p>}
              {!airing && <p className="text-[11px] text-slate-400">See calendar for scheduled airings</p>}
              <button type="button" aria-label={"Unfollow " + item.title}
                onClick={() => { try { updateCalendarFollow(item, false); setCalendarError(""); } catch (reason) { setCalendarError(reason instanceof Error ? reason.message : "Could not remove calendar follow."); } }}
                className="min-h-9 rounded-lg border border-sky-500/30 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/10">Unfollow</button>
            </div>
          </article>;
        })}</div>
      </section>
    )}
    <Link href="/notifications" className="inline-block text-sm text-purple-300">View notification history →</Link>
  </div>;
}
