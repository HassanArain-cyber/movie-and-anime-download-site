import Link from "next/link";
import { isPublicDiscoverAnime, normalizeDiscoverQuery, safeDiscoverUrl } from "@/lib/discover";

export const dynamic = "force-dynamic";

type Anime = {
  id: number;
  isAdult: boolean;
  title: { english: string | null; romaji: string | null };
  coverImage: { large: string | null };
  episodes: number | null;
  seasonYear: number | null;
  siteUrl: string;
  format: string | null;
};

async function getAnime(search: string): Promise<Anime[]> {
  const query = `query ($search: String) {
    Page(page: 1, perPage: 30) {
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, search: $search) {
        id isAdult title { english romaji } coverImage { large }
        episodes seasonYear siteUrl format
      }
    }
  }`;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { search: search || null } }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: { Page?: { media?: Anime[] } } };
    return (payload.data?.Page?.media ?? []).filter(isPublicDiscoverAnime);
  } catch {
    // An external catalog outage must not affect the manually managed Vault.
    return [];
  }
}

export default async function DiscoverAnimePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const search = normalizeDiscoverQuery(q);
  const anime = await getAnime(search);
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
      <form action="/discover" method="get" role="search" className="flex gap-2">
        <input name="q" type="search" defaultValue={search} maxLength={100} aria-label="Search anime" placeholder="Search anime..." className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white" />
        <button type="submit" className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-500">Search</button>
      </form>
      {anime.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 p-5 text-sm text-neutral-400">
          {search ? "No results found, or AniList is temporarily unavailable." : "Anime discovery is temporarily unavailable."} Your Vault library still works normally.
        </p>
      ) : (
        <div className="vault-poster-grid vault-editorial-grid grid">
          {anime.map((item) => (
            <Link key={item.id} href={"/discover/" + item.id}
              className="vault-card group block min-w-0" aria-label={`View ${item.title.english || item.title.romaji} in Vault`}>
              <div className="vault-card-poster relative aspect-[2/3] overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
                {safeDiscoverUrl(item.coverImage?.large) ? (
                  // External AniList images are rendered without changing Next image allowlists.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={safeDiscoverUrl(item.coverImage.large) ?? undefined} alt="" loading="lazy" className="h-full w-full object-contain" />
                ) : null}
                <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs text-white">Discover</span>
              </div>
              <div className="px-0.5 pb-2 pt-3">
                <h2 className="line-clamp-2 text-sm font-semibold text-white group-hover:text-purple-300">{item.title.english || item.title.romaji}</h2>
                <p className="mt-1 text-xs text-neutral-400">
                  {[item.seasonYear, item.episodes ? `${item.episodes} episodes` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
