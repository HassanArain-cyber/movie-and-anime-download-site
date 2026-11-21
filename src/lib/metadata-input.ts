import { ApiError, text } from "@/lib/validation";

export function optionalEpisodeCount(value: unknown): number | null {
  if (value === null || value === "" || value === undefined) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new ApiError(400, "Episode count must be between 1 and 10000");
  return count;
}
export function metadataFields(body: Record<string, unknown>) {
  const genres = text(body.genres, "Genres", 500);
  const episodeCount = optionalEpisodeCount(body.episodeCount);
  const source = text(body.externalSource, "Metadata provider", 20);
  const externalId = text(body.externalId, "Metadata ID", 60);
  if (source !== null && !["anilist", "tmdb", "tvmaze"].includes(source)) throw new ApiError(400, "Invalid metadata source");
  if ((source === null) !== (externalId === null)) throw new ApiError(400, "Metadata source and ID must be set together");
  if (externalId !== null && !/^[0-9]{1,16}$/.test(externalId)) throw new ApiError(400, "Invalid provider ID");
  return { genres, episodeCount, externalSource: source, externalId };
}
