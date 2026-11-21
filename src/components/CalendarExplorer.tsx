"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PosterImage from "@/components/PosterImage";
import { useUpdates } from "@/components/UpdatesProvider";
import { useCalendarFollows } from "@/components/useCalendarFollows";
import { calendarEventIsFollowed, calendarFollowIdentity, calendarFollowKey, followFromEvent, updateCalendarFollow } from "@/lib/calendar-follows";
import { calendarDay, type CalendarEvent, type CalendarKind, type CalendarResponse } from "@/lib/calendar-model";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COLORS: Record<CalendarKind, { dot: string; background: string; label: string }> = {
  episode: { dot: "bg-emerald-400", background: "bg-emerald-400/15 text-emerald-200", label: "Episode Release" },
  "new-series": { dot: "bg-orange-400", background: "bg-orange-400/15 text-orange-200", label: "New Series" },
  movie: { dot: "bg-yellow-400", background: "bg-yellow-400/15 text-yellow-100", label: "Movie Release" },
  special: { dot: "bg-rose-400", background: "bg-rose-400/15 text-rose-200", label: "Special" },
};
const displayDate = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const todayKey = () => calendarDay(new Date().toISOString());
const dayKey = (year: number, month: number, day: number) =>
  String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");

function InfoIcon({ direction }: { direction: "left" | "right" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {direction === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
  </svg>;
}

function ReleaseRow({ release, asOf, followed, followBusy, onToggleFollow }: {
  release: CalendarEvent; asOf: string; followed: boolean; followBusy: boolean;
  onToggleFollow?: () => void;
}) {
  const kind = COLORS[release.kind];
  const past = Date.parse(release.airingAt) <= Date.parse(asOf);
  const content = (
    <div className="flex min-w-0 items-start gap-2.5">
      <div className="relative h-[64px] w-[48px] shrink-0 overflow-hidden rounded-lg border border-sky-400/15 bg-[#13213a] shadow-md shadow-black/20">
        <PosterImage src={release.posterUrl} title={release.title} sizes="48px" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-xs font-bold leading-snug text-white sm:text-[13px]">{release.title}</h3>
        <p className="mt-0.5 text-[11px] text-slate-300">
          {release.episode ? "Episode " + release.episode : release.source === "jikan" ? "Weekly broadcast" : kind.label}
          {release.totalEpisodes ? " · " + release.totalEpisodes + " total eps" : ""}
        </p>
        {release.source === "anilist" && typeof release.airedEpisodes === "number" && <p className="mt-0.5 text-[11px] font-medium text-emerald-300">~{release.airedEpisodes} episodes aired (estimate)</p>}
        <p className="mt-0.5 text-[11px] text-slate-400">{displayDate.format(new Date(release.airingAt))} PKT</p>
        {release.notes && <p className="mt-1 line-clamp-2 text-[10px] leading-normal text-slate-400">{release.notes}</p>}
        <p className="mt-0.5 text-[10px] font-medium text-slate-500">
          {release.source === "anilist" ? "AniList schedule" : release.source === "jikan" ? "MAL weekly estimate" : release.source === "vault" ? "Vault publication" : "Admin update"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={"rounded-md px-1.5 py-0.5 text-[10px] font-bold " + kind.background}>
          {release.source === "jikan" ? "Weekly" : release.source === "vault" ? "On Vault" : past ? "Aired" : release.kind === "episode" ? "Episode" : kind.label}
        </span>
        {release.url && <span aria-hidden="true" className="text-sky-300/70">↗</span>}
      </div>
    </div>
  );
  return (
    <article className="min-w-0 rounded-lg border border-transparent px-1 py-1.5 transition hover:border-sky-400/20 hover:bg-white/[0.05]">
      {release.url
        ? <a href={release.url} target={release.url.startsWith("http") ? "_blank" : undefined}
          rel={release.url.startsWith("http") ? "noopener noreferrer" : undefined}
          aria-label={"View " + release.title + " release details"}
          className="block min-w-0 rounded-lg px-0.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">{content}</a>
        : <div className="min-w-0 px-0.5 py-1">{content}</div>}
      {onToggleFollow && (
        <div className="mt-1 flex min-w-0 items-center gap-2 pl-[3.55rem]">
          <button type="button" aria-label={(followed ? "Unfollow " : "Follow ") + release.title}
            aria-pressed={followed} aria-busy={followBusy} disabled={followBusy}
            onClick={onToggleFollow}
            className={`min-h-9 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${followed
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
              : "border-violet-400/35 bg-violet-600/20 text-violet-200 hover:bg-violet-600/35"}`}>
            {followBusy ? "Saving…" : followed ? "✓ Following" : "+ Follow"}
          </button>
          <span className="min-w-0 text-[10px] text-slate-500">{release.vaultMediaId ? "Vault" : "Calendar"}</span>
        </div>
      )}
    </article>
  );
}

export default function CalendarExplorer({ initial }: { initial: CalendarResponse }) {
  const [period, setPeriod] = useState({ year: initial.year, month: initial.month });
  const [data, setData] = useState(initial);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(36);
  const { data: followsData, follow: followVault } = useUpdates();
  const savedCalendarFollows = useCalendarFollows();
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [followError, setFollowError] = useState("");
  type NextAiring = { anilistId: number; episode: number; airingAt: string; totalEpisodes: number | null };
  const [nextAirings, setNextAirings] = useState<NextAiring[]>([]);
  const followedAniListIds = [...new Set([
    ...savedCalendarFollows.filter((item) => item.source === "anilist").map((item) => item.externalId),
    ...(followsData?.following ?? []).filter((item) => item.externalSource === "anilist" && /^\d+$/.test(item.externalId || "")).map((item) => Number(item.externalId)),
  ])].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 35).join(",");

  useEffect(() => {
    if (!onlyFollowed || !followedAniListIds) return;
    const controller = new AbortController();
    fetch("/api/next-airings?ids=" + followedAniListIds, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { airings?: NextAiring[] } | null) => {
        if (!controller.signal.aborted) setNextAirings(body?.airings ?? []);
      }).catch(() => { if (!controller.signal.aborted) setNextAirings([]); });
    return () => controller.abort();
  }, [onlyFollowed, followedAniListIds]);

  const toggleReleaseFollow = async (release: CalendarEvent) => {
    const identity = calendarFollowIdentity(release);
    const saved = identity ? savedCalendarFollows.find((entry) => calendarFollowKey(entry) === identity) : undefined;
    const vaultId = release.vaultMediaId;
    const linked = typeof vaultId === "number" && followsData?.following.some((item) => item.id === vaultId);
    const token = release.id;
    if (followBusy !== null) return;
    setFollowBusy(token); setFollowError("");
    try {
      if (typeof vaultId === "number" && followsData) {
        if (linked) await followVault(vaultId, false);
        else if (saved) updateCalendarFollow(saved, false);
        else await followVault(vaultId, true);
      } else {
        const entry = saved || followFromEvent(release);
        if (!entry) throw new Error("This release has no linked anime ID to follow.");
        updateCalendarFollow(entry, !saved);
      }
    } catch (reason) { setFollowError(reason instanceof Error ? reason.message : "Could not update Following."); }
    finally { setFollowBusy(null); }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const changeMonth = (offset: number) => {
    const next = new Date(Date.UTC(period.year, period.month - 1 + offset, 1));
    const year = next.getUTCFullYear(), month = next.getUTCMonth() + 1;
    if (year < 2020 || year > 2100) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPeriod({ year, month });
    setActiveDay(null);
    setVisibleLimit(36);
    setBusy(true);
    setError("");
    fetch("/api/calendar?year=" + year + "&month=" + month, { signal: request.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.events)) throw new Error(payload.error || "Calendar could not load");
        return payload as CalendarResponse;
      })
      .then((payload) => { if (!request.signal.aborted) setData(payload); })
      .catch((reason) => { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Calendar could not load"); })
      .finally(() => { if (!request.signal.aborted) setBusy(false); });
  };

  const showToday = () => {
    const [y, m, d] = todayKey().split("-").map(Number);
    if (y === period.year && m === period.month) { setActiveDay(dayKey(y, m, d)); return; }
    const delta = (y - period.year) * 12 + (m - period.month);
    changeMonth(delta);
  };

  const firstDay = new Date(Date.UTC(period.year, period.month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const today = calendarDay(data.updatedAt);
  const currentMonth = data.year === period.year && data.month === period.month;
  const visibleEvents = useMemo(() => currentMonth ? data.events : [], [currentMonth, data.events]);

  const supplementalEvents = useMemo(() => {
    if (!onlyFollowed || !currentMonth) return [];
    const known = new Map<number, { title: string; posterUrl: string | null; vaultMediaId?: number }>();
    for (const follow of savedCalendarFollows) if (follow.source === "anilist") {
      known.set(follow.externalId, { title: follow.title, posterUrl: follow.posterUrl });
    }
    for (const follow of followsData?.following ?? []) {
      if (follow.externalSource === "anilist" && /^\d+$/.test(follow.externalId || "")) {
        known.set(Number(follow.externalId), { title: follow.title, posterUrl: follow.posterUrl, vaultMediaId: follow.id });
      }
    }
    return nextAirings.flatMap((airing): CalendarEvent[] => {
      const knownAnime = known.get(airing.anilistId);
      if (!knownAnime || !Number.isSafeInteger(airing.episode) || !Number.isFinite(Date.parse(airing.airingAt))
        || !calendarDay(airing.airingAt).startsWith(period.year + "-" + String(period.month).padStart(2, "0") + "-")) return [];
      return [{
        id: "followed:anilist:" + airing.anilistId + ":" + airing.episode,
        title: knownAnime.title, kind: "episode", airingAt: airing.airingAt,
        episode: airing.episode, totalEpisodes: airing.totalEpisodes,
        posterUrl: knownAnime.posterUrl, url: "https://anilist.co/anime/" + airing.anilistId,
        source: "anilist", notes: "Next confirmed AniList schedule", anilistId: airing.anilistId,
        vaultMediaId: knownAnime.vaultMediaId ?? null,
      }];
    });
  }, [nextAirings, savedCalendarFollows, followsData, period.year, period.month, onlyFollowed, currentMonth]);

  const filteredEvents = useMemo(() => {
    if (!onlyFollowed) return visibleEvents;
    const followed = followsData?.following ?? [];
    const matches = visibleEvents.filter((event) => calendarEventIsFollowed(event, savedCalendarFollows, followed));
    for (const next of supplementalEvents) {
      if (!matches.some((item) => item.anilistId === next.anilistId && item.episode === next.episode)) matches.push(next);
    }
    return matches.sort((a, b) => a.airingAt.localeCompare(b.airingAt) || a.title.localeCompare(b.title));
  }, [visibleEvents, followsData, savedCalendarFollows, supplementalEvents, onlyFollowed]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of filteredEvents) {
      const date = calendarDay(event.airingAt);
      map.set(date, [...(map.get(date) ?? []), event]);
    }
    return map;
  }, [filteredEvents]);

  const shown = activeDay ? (eventsByDay.get(activeDay) ?? []) : filteredEvents;
  const trackedShows = [
    ...(followsData?.following ?? []).map((item) => ({ key: "vault:" + item.id, title: item.title })),
    ...savedCalendarFollows.filter((item) => !(item.source === "anilist" && followsData?.following.some((vault) =>
      vault.externalSource === "anilist" && vault.externalId === String(item.externalId))))
      .map((item) => ({ key: item.source + ":" + item.externalId, title: item.title })),
  ];
  const airings = shown.filter((event) => event.source === "anilist");
  const sourceMessage = data.anilistStatus === "fallback"
    ? "AniList is unavailable. Showing MAL weekly broadcast estimates; episode numbers are not confirmed."
    : data.anilistStatus === "unavailable"
      ? "Live feeds are temporarily unavailable. Admin updates and Vault releases still appear."
      : data.anilistStatus === "partial"
        ? "AniList supplied a partial schedule. More releases may be listed on AniList."
        : data.anilistStatus === "disabled"
          ? "External schedules are disabled for this month."
          : "";
  const selectedLabel = activeDay
    ? new Date(activeDay + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" })
    : "Upcoming Releases";

  return <div className="mx-auto max-w-6xl space-y-4">
    <header className="relative overflow-hidden rounded-2xl border border-sky-800/35 bg-gradient-to-r from-[#071529] via-[#071c35] to-[#09203c] px-4 py-4 sm:px-6 sm:py-5">
      <div aria-hidden="true" className="absolute -right-6 -top-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-2xl font-extrabold text-slate-950 shadow-[0_8px_30px_#00d9aa33]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M8 14h3m-3 3h7" /></svg>
          </span>
          <div><p className="text-[10px] font-extrabold tracking-[.2em] text-sky-400">GOJO&apos;S VAULT</p><h1 className="mt-1 text-xl font-extrabold tracking-tight text-white sm:text-2xl">Release Calendar</h1>
            <p className="mt-1 text-xs text-slate-300 sm:text-sm">Episode air dates, new releases and your Vault updates.</p></div>
        </div>
        <p className="max-w-[9rem] -rotate-6 text-right text-sm italic leading-snug text-sky-200/80">Same Vibe,<br />More to Explore</p>
      </div>
    </header>

    <section aria-label="Anime release calendar" className="overflow-hidden rounded-2xl border border-sky-700/35 bg-[#071426]/95 p-3 shadow-[0_22px_60px_#00000045] sm:p-5">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,.95fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 rounded-xl border border-sky-600/20 bg-[#091b32] p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white">{MONTHS[period.month - 1]} {period.year}</h2>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous month" disabled={busy || (period.year === 2020 && period.month === 1)} onClick={() => changeMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/15 text-slate-300 hover:bg-sky-500/10 disabled:opacity-40"><InfoIcon direction="left" /></button>
              <button type="button" aria-label="Next month" disabled={busy || (period.year === 2100 && period.month === 12)} onClick={() => changeMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/15 text-slate-300 hover:bg-sky-500/10 disabled:opacity-40"><InfoIcon direction="right" /></button>
              <button type="button" onClick={showToday} className="ml-1 rounded-lg border border-sky-500/25 px-2.5 py-2 text-xs text-sky-200 hover:bg-sky-400/10">Today</button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" aria-pressed={onlyFollowed} onClick={() => { setOnlyFollowed((value) => !value); setVisibleLimit(36); }}
              className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-bold transition ${onlyFollowed ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100" : "border-sky-500/20 bg-sky-500/[.06] text-sky-200 hover:bg-sky-500/15"}`}>
              {onlyFollowed ? "✓ Only Following" : "Only Following"}
            </button>
            <span className="text-[10px] text-slate-500">{onlyFollowed ? "Anime you've followed" : "Follow anime directly from the release list"}</span>
          </div>
          {onlyFollowed && (
            <div aria-label="Your tracked anime" className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-500/[.04] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-emerald-100">Following ({trackedShows.length})</p>
                <a href="/following" className="text-[11px] font-semibold text-sky-300 hover:underline">Manage follows</a>
              </div>
              {trackedShows.length ? (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                  {trackedShows.slice(0, 16).map((item) => <span key={item.key} title={item.title} className="max-w-36 shrink-0 truncate rounded-lg border border-sky-500/20 bg-sky-500/[.08] px-2.5 py-1.5 text-[11px] text-sky-100">{item.title}</span>)}
                  {trackedShows.length > 16 && <span className="shrink-0 px-2 py-1.5 text-[11px] text-slate-400">+{trackedShows.length - 16} more</span>}
                </div>
              ) : <p className="mt-2 text-[11px] leading-relaxed text-slate-400">Choose All releases, then tap + Follow on any anime you want to track.</p>}
            </div>
          )}
          <div className="mt-2 grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((name) => <span key={name} className="py-2 text-[10px] font-semibold text-slate-400">{name}</span>)}
            {Array.from({ length: firstDay }, (_, index) => <span key={"blank-" + index} aria-hidden="true" />)}
            {Array.from({ length: dayCount }, (_, i) => {
              const number = i + 1, date = dayKey(period.year, period.month, number);
              const dayEvents = eventsByDay.get(date) ?? [];
              const isSelected = activeDay === date;
              const isToday = date === today;
              const kinds = [...new Set(dayEvents.map((item) => item.kind))].slice(0, 3);
              return <button key={date} type="button" aria-label={date + ", " + dayEvents.length + " releases"} aria-pressed={isSelected} onClick={() => setActiveDay(isSelected ? null : date)}
                className={"flex min-h-[38px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-0.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 " +
                  (isSelected ? "border-emerald-300 bg-emerald-400/25 text-white" : isToday ? "border-sky-500/60 bg-sky-500/20 text-sky-100" : dayEvents.length ? "border-sky-600/10 bg-sky-400/[0.05] text-slate-200 hover:bg-sky-500/15" : "border-transparent text-slate-400 hover:bg-white/[0.04]")}>
                <span>{number}</span>
                <span className="flex h-1.5 items-center justify-center gap-[3px]">
                  {kinds.map((kind) => <span key={kind} className={"h-1.5 w-1.5 rounded-full " + COLORS[kind].dot} />)}
                </span>
              </button>;
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 border-t border-sky-400/10 pt-4">
            {(Object.keys(COLORS) as CalendarKind[]).map((kind) =>
              <div key={kind} className="flex items-center gap-2 text-[11px] text-slate-300">
                <span className={"h-2.5 w-2.5 rounded-full " + COLORS[kind].dot} />{COLORS[kind].label}
              </div>,
            )}
          </div>
          <p className="mt-3 text-[10px] text-slate-500">All times shown in Pakistan time (PKT).</p>
        </div>

        <div className="flex min-w-0 flex-col rounded-xl border border-sky-600/20 bg-[#07182e] p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/15 pb-3">
            <div className="min-w-0"><h2 className="text-base font-bold text-white sm:text-lg">{selectedLabel}</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">{shown.length} {shown.length === 1 ? "release" : "releases"} this {activeDay ? "day" : "month"}{airings.length ? " · Live AniList data" : ""}</p></div>
            {activeDay && <button type="button" onClick={() => setActiveDay(null)} className="rounded-lg border border-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/10">All month</button>}
          </div>
          {sourceMessage && <p role="status" className="mt-3 rounded-lg border border-amber-300/15 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/85">{sourceMessage}</p>}
          {followError && <p role="alert" className="mt-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{followError}</p>}
          {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
          <div aria-busy={busy} className="mt-2 max-h-[440px] min-h-[170px] flex-1 divide-y divide-sky-300/10 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
            {busy || !currentMonth ? <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading releases…</div> :
              !shown.length ? <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-4 text-center">
                <span aria-hidden="true" className="text-3xl text-slate-600">◇</span>
                <p className="text-sm font-semibold text-slate-200">No releases listed</p>
                <p className="text-xs leading-relaxed text-slate-500">{onlyFollowed ? "No scheduled releases for your followed anime this month. Your follows are saved; try another month or view all releases." : "Try another date, or add a release from the Admin calendar."}</p>
              </div> :
                shown.slice(0, visibleLimit).map((release) => <ReleaseRow key={release.id} release={release} asOf={data.updatedAt}
                  followed={calendarEventIsFollowed(release, savedCalendarFollows, followsData?.following ?? [])}
                  followBusy={followBusy === release.id}
                  onToggleFollow={release.vaultMediaId || calendarFollowIdentity(release) ? () => void toggleReleaseFollow(release) : undefined} />)}
          </div>
          {shown.length > visibleLimit && <button type="button" onClick={() => setVisibleLimit((count) => count + 36)} className="mt-2 min-h-10 rounded-lg border border-sky-500/25 px-3 py-2 text-xs font-bold text-sky-200 transition hover:bg-sky-500/15">Show more · {shown.length - visibleLimit} remaining</button>}
          <p className="border-t border-sky-500/15 pt-3 text-[10px] leading-relaxed text-slate-500">Automatic schedules are provided by AniList, or estimated weekly MAL broadcast slots when AniList is unavailable. These are not confirmations that Vault has uploaded an episode.</p>
        </div>
      </div>
    </section>
  </div>;
}
