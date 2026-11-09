export type MediaType = "movie" | "anime" | "series";
// Stored in the existing download_links/r2_uploads varchar(10) columns.
// The 2K/4K/8K aliases are displayed alongside their common pixel heights.
export type VideoQuality = "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p" | "4320p" | "other";
export type UploadKind = "image" | "video" | "archive";
export type StorageProvider = "r2" | "local" | "external" | "telegram";
// How a public download button behaves. "open" navigates to the link (the
// historical behaviour); "copy" copies the URL to the clipboard instead.
export type LinkBehavior = "open" | "copy";

export interface Media {
  isAnimeMovie?: boolean;
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
  commentsEnabled?: boolean;
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
  commentsEnabled?: boolean;
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
  linkBehavior: LinkBehavior;
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
