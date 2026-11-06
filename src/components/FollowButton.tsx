"use client";
import { useState } from "react";
import { WATCH_STATUSES, type WatchStatus } from "@/lib/watch-status";
import { useUpdates } from "./UpdatesProvider";
export default function FollowButton({ mediaId, mediaType, followerCount, compact = false }: { mediaId: number; mediaType?: string; followerCount?: number; compact?: boolean }) {
  const { data, error: loadError, follow, refresh, setStatus } = useUpdates();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [count, setCount] = useState(followerCount);
  const followedTitle = data?.following.find((title) => title.id === mediaId);
  const following = !!followedTitle;
  const movie = (mediaType ?? followedTitle?.type) === "movie";
  return <div className="min-w-0 space-y-1.5">
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <button type="button" disabled={!data || busy} aria-pressed={following} onClick={async () => {
        setBusy(true); setError("");
        try { setCount(await follow(mediaId, !following)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }} className={`min-h-9 max-w-full rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${following ? "border-purple-500/50 bg-purple-500/15 text-purple-200" : "border-neutral-700 text-white hover:border-purple-400"}`}>
        {busy ? "Saving…" : following ? "Unfollow" : data ? "+ Follow" : "Loading…"}
      </button>
      {followedTitle && <label className="min-w-0 max-w-full text-xs text-neutral-400">
        <span className={compact ? "sr-only" : "mb-1 block"}>Watch status</span>
        <select aria-label="Watch status" disabled={busy} value={followedTitle.watchStatus} onChange={async (event) => {
          const status = event.target.value as WatchStatus;
          setBusy(true); setError("");
          try { await setStatus(mediaId, status); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }} className="block min-h-9 w-36 max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50">
          {WATCH_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
      </label>}
      {followerCount !== undefined && <span className="text-xs text-neutral-400" aria-live="polite">{count?.toLocaleString()} {count === 1 ? "follower" : "followers"}</span>}
    </div>
    {!compact && <p className="text-xs text-neutral-400">{movie
      ? "Save this movie and manage its watch status. No account needed."
      : following ? "New episode alerts are saved in your notification bell." : "Follow for new episode alerts. No account needed."}</p>}
    {(error || loadError) && <p role="alert" className="text-xs text-red-300">{error || loadError} {!data && <button className="min-h-9 px-1 underline" onClick={() => void refresh()}>Retry</button>}</p>}
  </div>;
}
