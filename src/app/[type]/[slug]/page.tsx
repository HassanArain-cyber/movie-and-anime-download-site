import { notFound } from "next/navigation";
import PosterImage from "@/components/PosterImage";
import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { animeFollows, media } from "@/db/schema";
import DownloadOptions from "@/components/DownloadOptions";
import FollowButton from "@/components/FollowButton";
import EpisodeList from "@/components/EpisodeList";
import CommentSection from "@/components/CommentSection";
import { getMediaDetails } from "@/lib/library";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ type: string; slug: string }>; }

export default async function DetailPage({ params }: PageProps) {
  const { type, slug } = await params;
  const [found] = await db.select({ id: media.id }).from(media).where(and(eq(media.slug, slug), eq(media.type, type))).limit(1);
  if (!found) notFound();
  const item = await getMediaDetails(found.id);
  let followerCount: number | undefined;
  try { followerCount = (await db.select({ value: count() }).from(animeFollows).where(eq(animeFollows.mediaId, item.id)))[0].value; }
  catch (error) {
    // A Preview can precede the explicitly authorized migration. An optional
    // follower count must not break the existing detail/download workflows.
    const pgError = error as { code?: string; cause?: { code?: string } };
    if ((pgError.code || pgError.cause?.code) !== "42P01") throw error;
  }
  const typeLabel = item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "Series";

  return (
    <div className="vault-detail-page space-y-6">
      <Link href={item.type === "movie" ? "/movie" : item.type === "anime" ? "/anime" : "/series"} className="inline-block text-sm text-neutral-400 hover:text-white">← Back to {typeLabel.toLowerCase()}</Link>
      <div className="vault-detail">
        <div className="vault-detail-poster">
          <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-neutral-800">
            <PosterImage src={item.posterUrl} title={item.title} sizes="(max-width: 768px) 35vw, 240px" />
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-purple-500/10 px-2 py-0.5 font-medium text-purple-300 ring-1 ring-purple-500/30">{typeLabel}</span>
              {item.categoryName && <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-neutral-300">{item.categoryName}</span>}
              {item.year && <span className="text-neutral-500">{item.year}</span>}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">{item.title}</h1>
          </div>
          <FollowButton mediaId={item.id} mediaType={item.type} followerCount={followerCount} />
          {item.description && <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-neutral-300">{item.description}</p>}
          {(item.downloadLinks?.length || 0) > 0 && <div className="space-y-3 pt-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{item.type === "movie" ? "Available downloads · choose a quality" : "Additional links"}</h2>
            <DownloadOptions links={item.downloadLinks!} />
          </div>}
          {item.type === "movie" && !item.downloadLinks?.length && <p className="text-sm text-neutral-500">No download links available yet.</p>}
        </div>
      </div>

      {item.type !== "movie" && <div className="space-y-4">
        <div><p className="vault-eyebrow">KEEP EXPLORING</p><h2 className="mt-1 text-xl font-bold text-white">Seasons &amp; episodes</h2></div>
        {!item.seasons?.length && <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-neutral-500">No seasons or episodes added yet.</div>}
        {item.seasons?.map((season) => <details key={season.id} open className="vault-season group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 sm:p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-sm font-bold text-purple-300">{String(season.seasonNumber).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white sm:text-base">Season {season.seasonNumber}{season.name ? ` — ${season.name}` : ""}</span><span className="mt-1 block text-xs text-neutral-400">{season.episodes.length} episodes</span></span>
            <span aria-hidden="true" className="text-purple-300 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="space-y-4 border-t border-white/5 p-3 sm:p-5">
          {season.downloadLinks.length > 0 && <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Complete season downloads</h3>
            <DownloadOptions links={season.downloadLinks} />
          </div>}
          <EpisodeList mediaId={item.id} episodes={season.episodes} />
          </div>
        </details>)}
      </div>}

      <CommentSection mediaId={item.id} enabled={item.commentsEnabled !== false} />
    </div>
  );
}
