"use client";
import Link from "next/link";
import { useState } from "react";
import { NotificationItem } from "./NotificationBell";
import { updatesRequest, useUpdates, type EpisodeNotification } from "./UpdatesProvider";
export default function NotificationsPage() {
  const { data, error: loadError, markRead, refresh } = useUpdates();
  const [older, setOlder] = useState<EpisodeNotification[]>([]), [more, setMore] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const currentIds = new Set(data?.notifications.map((n) => n.id));
  const list = [...(data?.notifications || []), ...older.filter((n) => !currentIds.has(n.id))];
  const load = async () => {
    setBusy(true); setError("");
    try {
      const next = await updatesRequest<{ notifications: EpisodeNotification[]; hasMore: boolean }>(`/api/notifications?before=${list.at(-1)?.id || ""}`);
      setOlder((previous) => [...previous, ...next.notifications.filter((n) => !previous.some((p) => p.id === n.id))]); setMore(next.hasMore);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-3xl space-y-5">
    <div><p className="vault-eyebrow">NEW EPISODES</p><h1 className="mt-1 text-2xl font-bold text-white">Notifications</h1><p className="mt-2 text-sm text-neutral-400">New episode updates from your followed titles, only inside this website.</p></div>
    <div className="flex flex-wrap items-center gap-4 text-sm"><Link href="/following" className="text-purple-300">Following</Link><button className="min-h-11 text-purple-300" onClick={() => void refresh()}>Refresh</button>{!!data?.unread && <button className="min-h-11 text-purple-300" onClick={() => { void markRead().then(() => setOlder((rows) => rows.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })))).catch((e: Error) => setError(e.message)); }}>Mark all read ({data.unread})</button>}</div>
    {(error || loadError) && <p role="alert" className="text-sm text-red-300">{error || loadError}</p>}
    {!data && !loadError && <p className="text-sm text-neutral-400">Loading notifications…</p>}
    {data && !list.length && <p className="rounded-xl border border-dashed border-neutral-700 p-6 text-sm text-neutral-400">No notifications yet. Follow anime or series to receive an alert when an episode first gets a download link.</p>}
    <div className="space-y-2">{list.map((item) => <div key={item.id} className="rounded-lg border border-neutral-800"><NotificationItem item={item} /></div>)}</div>
    {data?.hasMore && more && <button disabled={busy} className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm disabled:opacity-40" onClick={() => void load()}>{busy ? "Loading…" : "Load older notifications"}</button>}
  </div>;
}
