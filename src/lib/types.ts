export type MediaType = "movie" | "anime" | "series";

export interface Media {
  id: number;
  type: MediaType;
  title: string;
  slug: string;
  description: string | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  year: number | null;
  categoryId: number | null;
  categoryName?: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface Season {
  id: number;
  mediaId: number;
  seasonNumber: number;
  name: string | null;
}

export interface Episode {
  id: number;
  mediaId: number;
  seasonId: number;
  episodeNumber: number;
  title: string | null;
  duration: string | null;
}

export interface DownloadLink {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  label: string | null;
  url: string;
  fileSize: string | null;
  isUploaded: boolean | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface MediaWithRelations extends Media {
  seasons?: (Season & { episodes?: Episode[] })[];
  downloadLinks?: DownloadLink[];
}

export interface EpisodeWithLinks extends Episode {
  downloadLinks: DownloadLink[];
}

export interface SeasonWithEpisodes extends Season {
  episodes: EpisodeWithLinks[];
}
