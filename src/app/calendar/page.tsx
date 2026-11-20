import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { episodePublications } from "@/db/schema";

export const dynamic = "force-dynamic";
export default async function CalendarPage() {
  const releases = await db.select({ title: episodePublications.title, season: episodePublications.seasonNumber, number: episodePublications.episodeNumber, episodeTitle: episodePublications.episodeTitle, url: episodePublications.url, date: episodePublications.publishedAt }).from(episodePublications).orderBy(desc(episodePublications.publishedAt)).limit(100);
  const grouped = new Map<string, typeof releases>();
  for (const release of releases) {
    const day = release.date.toISOString().slice(0, 10);
    grouped.set(day, [...(grouped.get(day) ?? []), release]);
  }
  return <main className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-purple-300">VAULT RELEASES</p><h1 className="mt-2 text-3xl font-bold text-white">Release Calendar</h1><p className="mt-2 text-sm text-neutral-400">Episodes published on Vault, grouped by date (UTC). Upcoming release dates are not available until scheduled by the publisher.</p></div>
    {grouped.size === 0 && <p className="rounded-xl border border-neutral-800 p-5 text-neutral-400">No published episodes recorded yet.</p>}
    {[...grouped].map(([day, entries]) => <section key={day} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/70"><h2 className="border-b border-neutral-800 bg-neutral-900/70 px-4 py-3 text-sm font-semibold text-purple-200">{new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2><div className="divide-y divide-neutral-800">{entries.map((entry, index) => <Link key={entry.url + index} href={entry.url} className="flex items-center justify-between gap-3 px-4 py-4 transition hover:bg-neutral-900"><span className="min-w-0"><strong className="block truncate text-sm text-white">{entry.title}</strong><span className="mt-1 block text-xs text-neutral-400">Season {entry.season} · Episode {entry.number}{entry.episodeTitle ? " · " + entry.episodeTitle : ""}</span></span><span className="shrink-0 text-xs text-purple-300">View →</span></Link>)}</div></section>)}
  </main>;
}
