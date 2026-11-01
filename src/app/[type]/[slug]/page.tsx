import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/db";
import { media, categories, seasons, episodes, downloadLinks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import DownloadButton from "@/components/DownloadButton";
import EpisodeList from "@/components/EpisodeList";
import { placeholderPoster } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ type: string; slug: string }>;
}

export default async function DetailPage({ params }: PageProps) {
  const { type, slug } = await params;

  const [item] = await db
    .select({
      id: media.id,
      type: media.type,
      title: media.title,
      slug: media.slug,
      description: media.description,
      posterUrl: media.posterUrl,
      thumbnailUrl: media.thumbnailUrl,
      year: media.year,
      categoryId: media.categoryId,
      categoryName: categories.name,
    })
    .from(media)
    .leftJoin(categories, eq(media.categoryId, categories.id))
    .where(and(eq(media.slug, slug), eq(media.type, type)))
    .limit(1);

  if (!item) notFound();

  // Get data based on type
  let movieLinks: any[] = [];
  let seasonList: any[] = [];

  if (item.type === "movie") {
    const allLinks = await db
      .select()
      .from(downloadLinks)
      .where(eq(downloadLinks.mediaId, item.id));
    movieLinks = allLinks.filter((l) => l.episodeId === null);
  } else {
    seasonList = await db
      .select()
      .from(seasons)
      .where(eq(seasons.mediaId, item.id))
      .orderBy(seasons.seasonNumber);

    for (const s of seasonList) {
      const eps = await db
        .select()
        .from(episodes)
        .where(eq(episodes.seasonId, s.id))
        .orderBy(episodes.episodeNumber);
      const epsWithLinks = [];
      for (const ep of eps) {
        const links = await db
          .select()
          .from(downloadLinks)
          .where(eq(downloadLinks.episodeId, ep.id));
        epsWithLinks.push({ ...ep, downloadLinks: links });
      }
      s.episodes = epsWithLinks;
    }
  }

  const typeLabel =
    item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "Series";

  return (
    <div className="space-y-8">
      <Link
        href={item.type === "movie" ? "/movie" : item.type === "anime" ? "/anime" : "/series"}
        className="inline-block text-sm text-neutral-400 hover:text-white"
      >
        ← Back to {typeLabel.toLowerCase()}
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto w-full max-w-[240px] shrink-0 sm:mx-0 sm:w-48 md:w-56">
          <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-neutral-800">
            <Image
              src={item.posterUrl || placeholderPoster(item.title)}
              alt={item.title}
              fill
              sizes="(max-width: 640px) 240px, 224px"
              className="object-cover"
              unoptimized={
                !!item.posterUrl &&
                (item.posterUrl.startsWith("data:") ||
                  item.posterUrl.startsWith("http"))
              }
            />
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-red-500/10 px-2 py-0.5 font-medium text-red-400 ring-1 ring-red-500/30">
                {typeLabel}
              </span>
              {item.categoryName && (
                <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-neutral-300">
                  {item.categoryName}
                </span>
              )}
              {item.year && (
                <span className="text-neutral-500">{item.year}</span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              {item.title}
            </h1>
          </div>

          {item.description && (
            <p className="max-w-2xl text-sm leading-relaxed text-neutral-400">
              {item.description}
            </p>
          )}

          {/* Movie downloads */}
          {item.type === "movie" && (
            <div className="space-y-3 pt-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Downloads
              </h2>
              {movieLinks.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No download links available yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {movieLinks.map((link) => (
                    <DownloadButton key={link.id} link={link} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Seasons / Episodes for anime/series */}
      {item.type !== "movie" && (
        <div className="space-y-6">
          {seasonList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
              No seasons or episodes added yet.
            </div>
          ) : (
            seasonList.map((season) => (
              <div key={season.id} className="space-y-3">
                <h2 className="text-lg font-semibold text-white">
                  Season {season.seasonNumber}
                  {season.name ? ` — ${season.name}` : ""}
                </h2>
                <EpisodeList episodes={season.episodes} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
