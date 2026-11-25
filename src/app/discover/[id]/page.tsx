import Link from "next/link";
import { notFound } from "next/navigation";
import { isPublicDiscoverAnime, plainDiscoverDescription, safeDiscoverUrl } from "@/lib/discover";

export const revalidate = 3600;

type AnimeDetail = {
  id: number;
  isAdult: boolean;
  title: { english: string | null; romaji: string | null };
  description: string | null;
  coverImage: { large: string | null } | null;
  episodes: number | null;
  seasonYear: number | null;
  siteUrl: string | null;
  streamingEpisodes: Array<{ title: string | null; url: string | null; site: string | null }> | null;
};

const QUERY = [
  "query VaultDiscovery($id: Int!) {",
  "  Media(id: $id, type: ANIME, isAdult: false) {",
  "    id isAdult title { english romaji } description(asHtml: false)",
  "    coverImage { large } episodes seasonYear siteUrl",
  "    streamingEpisodes { title url site }",
  "  }",
  "}",
].join("\n");

async function fetchDetail(id: number): Promise<{ anime: AnimeDetail | null; unavailable: boolean }> {
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { id } }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { anime: null, unavailable: true };
    const payload = await response.json() as { data?: { Media?: AnimeDetail | null }; errors?: unknown[] };
    if (payload.errors?.length) return { anime: null, unavailable: true };
    const anime = payload.data?.Media ?? null;
    return { anime: isPublicDiscoverAnime(anime) ? anime : null, unavailable: false };
  } catch {
    return { anime: null, unavailable: true };
  }
}

export default async function AnimeDiscoveryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,8}$/.test(id)) notFound();
  const { anime, unavailable } = await fetchDetail(Number(id));
  if (unavailable) {
    return <div className="space-y-4">
      <Link href="/discover" className="text-sm text-purple-300">← Back to Discover</Link>
      <p role="status" className="text-neutral-400">AniList is temporarily unavailable. Your Vault library is unaffected.</p>
    </div>;
  }
  if (!anime) notFound();

  const title = anime.title.english || anime.title.romaji || "Anime";
  const description = plainDiscoverDescription(anime.description);
  const posterUrl = safeDiscoverUrl(anime.coverImage?.large);
  const catalogUrl = safeDiscoverUrl(anime.siteUrl);
  const streaming = (anime.streamingEpisodes ?? [])
    .map((episode) => ({
      title: episode.title,
      site: episode.site,
      url: safeDiscoverUrl(episode.url),
    }))
    .filter((episode) => episode.url !== null)
    .slice(0, 80);

  return <div className="space-y-6">
    <Link href="/discover" className="text-sm text-purple-300">← Back to Discover</Link>
    <div className="flex items-start gap-4 sm:gap-6">
      {posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt={title + " poster"} className="h-44 w-28 shrink-0 rounded-xl bg-neutral-900 object-contain sm:h-64 sm:w-44" />
      )}
      <div className="min-w-0 space-y-3">
        <span className="text-xs font-medium text-violet-300">Discover · AniList</span>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
        <p className="text-sm text-neutral-400">
          {[anime.seasonYear, anime.episodes ? anime.episodes + " episodes" : null].filter(Boolean).join(" · ")}
        </p>
        <p className="text-xs text-neutral-400">Catalog information only. This title is not automatically added to the Vault library.</p>
        {catalogUrl && <a href={catalogUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-violet-300 hover:underline">View on AniList ↗</a>}
      </div>
    </div>
    {description && <p className="max-w-3xl text-sm leading-7 text-neutral-300">{description}</p>}
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-white">Streaming information</h2>
      <p className="text-sm text-neutral-400">External links are listed by AniList, not hosted or verified by Vault. Availability, audio and subtitles depend on the provider.</p>
      {streaming.length ? <div className="space-y-2">
        {streaming.map((episode, index) => (
          <a key={index} href={episode.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-neutral-800 p-3 text-sm text-violet-300 hover:border-violet-500">
            {episode.title || "Streaming episode"} · {episode.site || "External provider"} ↗
          </a>
        ))}
      </div> : <p className="text-sm text-neutral-500">No streaming links are listed for this title.</p>}
    </section>
  </div>;
}
