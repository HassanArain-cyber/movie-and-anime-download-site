"use client";
import { useState } from "react";
import { WATCH_STATUSES, type WatchStatus } from "@/lib/watch-status";
import { useUpdates } from "./UpdatesProvider";
export default function FollowButton({ mediaId, followerCount }: { mediaId: number; followerCount?: number }) {
  const { data, error: loadError, follow, refresh, setStatus } = useUpdates();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [count, setCount] = useState(followerCount);
  const followedTitle = data?.following.find((title) => title.id === mediaId);
  const following = !!followedTitle;
  return <div className="space-y-2">
    <button type="button" disabled={!data || busy} aria-pressed={following} onClick={async () => {
      setBusy(true); setError("");
      try { setCount(await follow(mediaId, !following)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }} className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${following ? "border-purple-500/50 bg-purple-500/15 text-purple-200" : "border-neutral-700 text-white hover:border-purple-400"}`}>
      {busy ? "Saving…" : following ? "Unfollow" : data ? "+ Follow" : "Loading follow preferences…"}
    </button>
    {followedTitle && <label className="block text-xs text-neutral-400">Watch status
      <select aria-label="Watch status" disabled={busy} value={followedTitle.watchStatus} onChange={async (event) => {
        const status = event.target.value as WatchStatus;
        setBusy(true); setError("");
        try { await setStatus(mediaId, status); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }} className="mt-1 block min-h-11 w-full max-w-48 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-sm text-white disabled:opacity-50">
        {WATCH_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
      </select>
    </label>}
    {followerCount !== undefined && <span className="ml-3 text-xs text-neutral-400" aria-live="polite">{count?.toLocaleString()} {count === 1 ? "follower" : "followers"}</span>}
    <p className="text-xs text-neutral-400">{following ? "New episode alerts are saved in your notification bell." : "Follow for new episode alerts. No account needed."}</p>
    {(error || loadError) && <p role="alert" className="text-xs text-red-300">{error || loadError} {!data && <button className="underline" onClick={() => void refresh()}>Retry</button>}</p>}
  </div>;
}
