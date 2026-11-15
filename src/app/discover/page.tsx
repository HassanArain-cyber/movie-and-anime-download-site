import Link from "next/link";

export const revalidate = 3600;

type Anime = {
  id: number;
  title: { english: string | null; romaji: string | null };
  coverImage: { large: string | null };
  episodes: number | null;
  seasonYear: number | null;
  siteUrl: string;
  format: string | null;
};

async function getAnime(): Promise<Anime[]> {
  const query = `query {
    Page(page: 1, perPage: 30) {
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
        id title { english romaji } coverImage { large }
        episodes seasonYear siteUrl format
      }
    }
  }`;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: { Page?: { media?: Anime[] } } };
    return payload.data?.Page?.media ?? [];
  } catch {
    // An external catalog outage must not affect the manually managed Vault.
    return [];
  }
}

export default async function DiscoverAnimePage() {
  const anime = await getAnime();
  return (
    <main className="space-y-6">
      <div>
        <Link href="/anime" className="text-sm text-purple-300 hover:underline">← Back to Vault anime</Link>
        <h1 className="mt-3 text-2xl font-bold text-white">Discover anime</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Automatically updated anime information from AniList. Your manually added Vault anime and downloads remain separate and unchanged.
        </p>
        <p className="mt-1 text-xs text-neutral-500">Episode counts are metadata, not playable streams. Audio language and subtitles are not verified here.</p>
      </div>
      {anime.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 p-5 text-sm text-neutral-400">
          Anime discovery is temporarily unavailable. Your Vault library still works normally.
        </p>
      ) : (
        <div className="vault-poster-grid vault-editorial-grid grid">
          {anime.map((item) => (
            <a key={item.id} href={item.siteUrl} target="_blank" rel="noopener noreferrer"
              className="vault-card group block min-w-0" aria-label={`View ${item.title.english || item.title.romaji} on AniList`}>
              <div className="vault-card-poster relative aspect-[2/3] overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
                {item.coverImage.large ? (
                  // External AniList images are rendered without changing Next image allowlists.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.coverImage.large} alt="" loading="lazy" className="h-full w-full object-contain" />
                ) : null}
                <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs text-white">Discover</span>
              </div>
              <div className="px-0.5 pb-2 pt-3">
                <h2 className="line-clamp-2 text-sm font-semibold text-white group-hover:text-purple-300">{item.title.english || item.title.romaji}</h2>
                <p className="mt-1 text-xs text-neutral-400">
                  {[item.seasonYear, item.episodes ? `${item.episodes} episodes` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
