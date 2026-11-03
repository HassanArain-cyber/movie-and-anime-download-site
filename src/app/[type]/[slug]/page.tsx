import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import DownloadOptions from "@/components/DownloadOptions";
import EpisodeList from "@/components/EpisodeList";
import CommentSection from "@/components/CommentSection";
import { getMediaDetails } from "@/lib/library";
import { needsUnoptimizedImage, placeholderPoster } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ type: string; slug: string }>; }

export default async function DetailPage({ params }: PageProps) {
  const { type, slug } = await params;
  const [found] = await db.select({ id: media.id }).from(media).where(and(eq(media.slug, slug), eq(media.type, type))).limit(1);
  if (!found) notFound();
  const item = await getMediaDetails(found.id);
  const typeLabel = item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "Series";
  const poster = item.posterUrl || placeholderPoster(item.title);

  return (
    <div className="space-y-8">
      <Link href={item.type === "movie" ? "/movie" : item.type === "anime" ? "/anime" : "/series"} className="inline-block text-sm text-neutral-400 hover:text-white">← Back to {typeLabel.toLowerCase()}</Link>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto w-full max-w-[240px] shrink-0 sm:mx-0 sm:w-48 md:w-56">
          <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-neutral-800">
            <Image src={poster} alt={item.title} fill sizes="(max-width: 640px) 240px, 224px" className="object-cover" unoptimized={needsUnoptimizedImage(poster)} />
          </div>
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-red-500/10 px-2 py-0.5 font-medium text-red-400 ring-1 ring-red-500/30">{typeLabel}</span>
              {item.categoryName && <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-neutral-300">{item.categoryName}</span>}
              {item.year && <span className="text-neutral-500">{item.year}</span>}
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{item.title}</h1>
          </div>
          {item.description && <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-neutral-400">{item.description}</p>}
          {(item.downloadLinks?.length || 0) > 0 && <div className="space-y-3 pt-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{item.type === "movie" ? "Available downloads · choose a quality" : "Additional links"}</h2>
            <DownloadOptions links={item.downloadLinks!} />
          </div>}
          {item.type === "movie" && !item.downloadLinks?.length && <p className="text-sm text-neutral-500">No download links available yet.</p>}
        </div>
      </div>

      {item.type !== "movie" && <div className="space-y-6">
        {!item.seasons?.length && <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-neutral-500">No seasons or episodes added yet.</div>}
        {item.seasons?.map((season) => <div key={season.id} className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Season {season.seasonNumber}{season.name ? ` — ${season.name}` : ""}</h2>
          {season.downloadLinks.length > 0 && <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Complete season downloads</h3>
            <DownloadOptions links={season.downloadLinks} />
          </div>}
          <EpisodeList mediaId={item.id} episodes={season.episodes} />
        </div>)}
      </div>}

      <CommentSection mediaId={item.id} enabled={item.commentsEnabled !== false} />
    </div>
  );
}
