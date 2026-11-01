export type MediaType = "movie" | "anime" | "series";
export type VideoQuality = "720p" | "1080p" | "other";
export type UploadKind = "image" | "video" | "archive";
export type StorageProvider = "r2" | "local" | "external" | "telegram";

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
  createdAt: Date | string | null;
  updatedAt?: Date | string | null;
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
  seasonId: number | null;
  episodeId: number | null;
  label: string | null;
  url: string;
  fileSize: string | null;
  isUploaded: boolean | null;
  quality: VideoQuality | null;
  storageProvider: StorageProvider | null;
  objectKey: string | null;
  sizeBytes: number | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface MediaWithRelations extends Media {
  seasons?: SeasonWithEpisodes[];
  downloadLinks?: DownloadLink[];
}

export interface EpisodeWithLinks extends Episode {
  downloadLinks: DownloadLink[];
}

export interface SeasonWithEpisodes extends Season {
  episodes: EpisodeWithLinks[];
  downloadLinks: DownloadLink[];
}

export interface StorageStatus {
  configured: boolean;
  missing: string[];
  maxVideoBytes: number;
  maxImageBytes: number;
  partSizeBytes: number;
  privateDownloads: true;
}

export interface UploadTarget {
  mediaId?: number | null;
  seasonId?: number | null;
  episodeId?: number | null;
  quality?: VideoQuality | null;
}

export interface UploadPart {
  partNumber: number;
  url: string;
  headers: Record<string, string>;
}

export interface InitializedUpload {
  id: string;
  kind: UploadKind;
  fileName: string;
  sizeBytes: number;
  partSizeBytes: number;
  target: Required<UploadTarget>;
  urlExpiresAt: string;
  parts: UploadPart[];
  uploadedParts: { partNumber: number; sizeBytes: number }[];
}

export interface CompletedUpload {
  id: string;
  url: string;
  imageUrl?: string;
  objectKey: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  kind: UploadKind;
  quality: VideoQuality | null;
}
