export type EpisodeDraft = {
  number: number;
  title: string;
  duration: string;
};

type TVMazeEpisode = {
  season?: number | null;
  number?: number | null;
  name?: string | null;
  runtime?: number | null;
};

/**
 * Some anime providers give a total episode count but no episode titles.
 * These are numbered drafts for Admin review, not published releases.
 */
export function numberedEpisodeDrafts(total: number, existing: readonly number[], max = 60): EpisodeDraft[] {
  if (!Number.isInteger(total) || total < 1 || total > 10000) return [];
  const used = new Set(existing);
  const results: EpisodeDraft[] = [];
  for (let number = 1; number <= total && results.length < max; number++) {
    if (!used.has(number)) results.push({ number, title: "Episode " + number, duration: "" });
  }
  return results;
}

export function tvmazeEpisodeDrafts(
  episodes: readonly TVMazeEpisode[], seasonNumber: number,
  existing: readonly number[], max = 60,
): EpisodeDraft[] {
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 1) return [];
  const used = new Set(existing);
  const mapped: EpisodeDraft[] = [];
  for (const episode of episodes.slice(0, 3000)) {
    const number = episode.number;
    if (episode.season !== seasonNumber || !Number.isInteger(number) ||
      typeof number !== "number" || number < 1 || number > 100000 || used.has(number)) continue;
    used.add(number);
    const name = typeof episode.name === "string" ? episode.name.trim().slice(0, 255) : "";
    const duration = episode.runtime && Number.isInteger(episode.runtime) &&
      episode.runtime >= 1 && episode.runtime <= 999 ? episode.runtime + "m" : "";
    mapped.push({ number, title: name || "Episode " + number, duration });
  }
  return mapped.sort((a, b) => a.number - b.number).slice(0, max);
}
