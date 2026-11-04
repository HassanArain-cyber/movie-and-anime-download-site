"use client";
import Link from "next/link";
import PosterImage from "./PosterImage";
import FollowButton from "./FollowButton";
import PushPreferences from "./PushPreferences";
import { useUpdates } from "./UpdatesProvider";
export default function FollowingPage() {
  const { data, error, refresh } = useUpdates();
  return <div className="space-y-6">
    <div><p className="vault-eyebrow">YOUR LIBRARY</p><h1 className="mt-1 text-2xl font-bold text-white">Following</h1><p className="mt-2 text-sm text-neutral-400">Anime and series saved in this browser. No login required.</p></div>
    <PushPreferences />
    <section aria-label="Followed titles" className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">Followed titles {data ? `(${data.following.length})` : ""}</h2><button className="min-h-11 text-xs text-purple-300" onClick={() => void refresh()}>Refresh</button></div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!data && !error && <p className="text-sm text-neutral-400">Loading your follows…</p>}
      {data && !data.following.length && <div className="rounded-xl border border-dashed border-neutral-700 p-6 text-sm text-neutral-400">You are not following anything yet. <Link className="text-purple-300 underline" href="/anime">Browse anime</Link> or <Link className="text-purple-300 underline" href="/series">browse series</Link>, then select Follow on a title.</div>}
      <div className="grid gap-3 md:grid-cols-2">{data?.following.map((item) => <article key={item.id} className="flex min-w-0 gap-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
        <Link href={`/${item.type}/${item.slug}`} className="relative h-28 w-20 shrink-0 overflow-hidden rounded-md"><PosterImage src={item.posterUrl} title={item.title} sizes="80px" /></Link>
        <div className="min-w-0 flex-1 space-y-2"><Link href={`/${item.type}/${item.slug}`} className="block break-words font-semibold text-white hover:text-purple-300">{item.title}</Link>
          {item.hasNew && <Link href="/notifications" className="inline-block rounded bg-purple-500/15 px-2 py-1 text-xs text-purple-200">New episodes</Link>}
          <FollowButton mediaId={item.id} />
        </div>
      </article>)}</div>
    </section>
    <Link href="/notifications" className="inline-block text-sm text-purple-300">View notification history →</Link>
  </div>;
}
