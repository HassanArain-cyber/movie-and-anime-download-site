/** Presentation metadata only; lifecycle rules remain enforced by existing APIs. */
export type BinItem = {
  kind: "media" | "season" | "episode"; id: number; title: string; type: string; deletedAt: string;
  mediaId?: number | null; mediaTitle?: string | null; seasonId?: number | null; seasonNumber?: number | null;
  episodeNumber?: number | null; episodeTitle?: string | null; parentDeleted?: boolean;
};
export type BinSeason = { key: string; number: number | null; items: BinItem[] };
export type BinFolder = { key: string; title: string; count: number; seasons: BinSeason[] };
export function episodeFolders(items: BinItem[]): BinFolder[] {
  const folders = new Map<string, BinFolder>();
  for (const item of items) {
    if (item.kind !== "episode") continue;
    const key = String(item.mediaId ?? "unknown");
    let folder = folders.get(key);
    if (!folder) { folder = { key, title: item.mediaTitle || "Unknown title", count: 0, seasons: [] }; folders.set(key, folder); }
    const seasonKey = `${key}:${item.seasonId ?? "unknown"}`;
    let season = folder.seasons.find((value) => value.key === seasonKey);
    if (!season) { season = { key: seasonKey, number: item.seasonNumber ?? null, items: [] }; folder.seasons.push(season); }
    season.items.push(item); folder.count++;
  }
  return [...folders.values()].sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key)).map((folder) => ({ ...folder,
    seasons: folder.seasons.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.key.localeCompare(b.key)).map((season) => ({ ...season, items: season.items.sort((a, b) => (a.episodeNumber ?? Infinity) - (b.episodeNumber ?? Infinity) || a.id - b.id) })),
  }));
}
