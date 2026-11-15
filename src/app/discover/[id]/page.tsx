import Link from "next/link";
import { notFound } from "next/navigation";

export const revalidate = 3600;

type Anime = {
  id: number;
  title: { english: string | null; romaji: string | null };
  description: string | null;
  coverImage: { large: string | null };
  episodes: number | null;
  seasonYear: number | null;
  siteUrl: string;
  streamingEpisodes: { title: string | null; url: string | null; site: string | null }[];
};

export default async function AnimeDiscoveryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const query = `query ($id: Int) {
    Media(id: $id, type: ANIME, isAdult: false) {
      id title { english romaji } description(asHtml: false)
      coverImage { large } episodes seasonYear siteUrl
      streamingEpisodes { title url site }
    }
  }`;
  let anime: Anime | null = null;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { id: Number(id) } }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const payload = (await response.json()) as { data?: { Media?: Anime } };
      anime = payload.data?.Media ?? null;
    }
  } catch {
    // Keep discovery failures isolated from manual Vault content.
  }
  if (!anime) return <main className="space-y-4"><Link href="/discover" className="text-purple-300">← Back to Discover</Link><p className="text-neutral-400">Anime details temporarily unavailable.</p></main>;
  const title = anime.title.english || anime.title.romaji || "Anime";
  // Only explicitly observed source URLs; never fabricate episode URLs.
  const source = anime.id === 113415 ? {
    series: "https://animesalt.cx/series/jujutsu-kaisen/",
    episodes: [{ season: 1, episode: 1, title: "Ryomen Sukuna", url: "https://animesalt.cx/episode/jujutsu-kaisen-1x1/" }],
  } : null;
  return <main className="space-y-6">
    <Link href="/discover" className="text-sm text-purple-300">← Back to Discover</Link>
    <div className="flex gap-5">
      {anime.coverImage.large && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={anime.coverImage.large} alt="" className="h-44 w-28 shrink-0 rounded-lg object-cover sm:h-64 sm:w-44" />
      )}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="text-sm text-neutral-400">{[anime.seasonYear, anime.episodes ? `${anime.episodes} episodes` : null].filter(Boolean).join(" · ")}</p>
        <p className="text-sm text-neutral-400">Audio and subtitle availability is not confirmed.</p>
      </div>
    </div>
    {anime.description && <p className="whitespace-pre-line text-sm leading-7 text-neutral-300">{anime.description.replace(/<[^>]*>/g, "")}</p>}
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-white">Episodes & watching</h2>
      <p className="text-sm text-neutral-400">AniList episode totals are informational. Streaming links are only shown when supplied by the catalog; playback and language support depend on the provider.</p>
      {source && (
        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-neutral-900/60 p-4">
          <h3 className="font-semibold text-white">AnimeSalt · External source</h3>
          <p className="text-xs text-neutral-400">Opens the original provider. Playback and download options are managed by AnimeSalt, not Vault.</p>
          <a href={source.series} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg border border-violet-500/50 px-3 py-2 text-sm text-violet-200">View all seasons ↗</a>
          {source.episodes.map((ep) => (
            <div key={ep.url} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 p-3">
              <span className="text-sm text-neutral-200">S{ep.season} E{ep.episode} · {ep.title}</span>
              <a href={ep.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white">Watch / Download at source ↗</a>
            </div>
          ))}
        </div>
      )}
      {anime.streamingEpisodes.length ? (
        <div className="space-y-2">
          {anime.streamingEpisodes.filter(ep => ep.url && /^https:\/\//i.test(ep.url)).map((ep, index) => (
            <a key={index} href={ep.url!} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-neutral-800 p-3 text-sm text-purple-300 hover:border-purple-500">
              {ep.title || `Episode ${index + 1}`} · {ep.site || "External provider"} ↗
            </a>
          ))}
        </div>
      ) : <p className="text-sm text-neutral-500">No verified streaming provider available for this title.</p>}
    </section>
  </main>;
}
