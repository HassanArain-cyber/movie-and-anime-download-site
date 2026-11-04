import { safeExternalUrl } from "./media-links";
import type { CompletedUpload, EpisodeWithLinks, VideoQuality } from "./types";

export interface BulkEpisodeRow {
  id: string;
  number: string;
  title: string;
  duration: string;
  url: string;
  quality: VideoQuality;
  file?: File;
  episodeId?: number;
  uploadId?: string;
  completed?: CompletedUpload;
  uncertainCreation?: boolean;
  status: "pending" | "creating" | "uploading" | "attaching" | "done" | "error";
  progress: number;
  error?: string;
}

export function guessEpisodeNumber(name: string): string {
  const match = /(?:S\d{1,2}E|EP?[ ._-]?)(\d{1,4})/i.exec(name) || /(?:^|[ ._-])(\d{1,4})(?:[ ._-]|$)/.exec(name.replace(/\.[^.]+$/, ""));
  return match ? String(Number(match[1])) : "";
}

export function validateBulkEpisodes(rows: BulkEpisodeRow[], existing: Pick<EpisodeWithLinks, "id" | "episodeNumber">[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(Number(row.number), (counts.get(Number(row.number)) ?? 0) + 1);
  for (const row of rows.filter((entry) => entry.status !== "done")) {
    const number = Number(row.number);
    if (!/^\d+$/.test(row.number) || !Number.isSafeInteger(number) || number < 1 || number > 100000) errors[row.id] = "Enter an episode number from 1 to 100000.";
    else if ((counts.get(number) ?? 0) > 1) errors[row.id] = "Duplicate episode number in this batch.";
    else if (existing.some((episode) => episode.episodeNumber === number && episode.id !== row.episodeId)) errors[row.id] = "That episode number already exists in this season.";
    else if (row.uncertainCreation) errors[row.id] = "The episode creation response was lost. Review this number in Media before starting a new batch; do not submit it again blindly.";
    else if (!row.title.trim() || row.title.trim().length > 255) errors[row.id] = "Enter a title (up to 255 characters).";
    else if (row.duration.trim().length > 20) errors[row.id] = "Duration must be at most 20 characters.";
    else if (row.file && row.url.trim()) errors[row.id] = "Choose a file OR a download link, not both.";
    else if (!row.file && !safeExternalUrl(row.url.trim())) errors[row.id] = "Choose a video file or enter a supported HTTP(S), Telegram, or magnet link.";
    else if (row.file && (row.file.size === 0 || !/\.(mp4|webm|mkv|mov|avi|m4v)$/i.test(row.file.name))) errors[row.id] = "Choose a non-empty supported video file.";
  }
  return errors;
}

interface Services {
  create: (row: BulkEpisodeRow) => Promise<{ id: number }>;
  upload: (row: BulkEpisodeRow, checkpoint: (patch: Partial<BulkEpisodeRow>) => void) => Promise<CompletedUpload>;
  links: (episodeId: number) => Promise<EpisodeWithLinks["downloadLinks"]>;
  attach: (row: BulkEpisodeRow) => Promise<void>;
}

/** Each row checkpoints independently. A retry never recreates a known episode. */
export async function processBulkEpisode(row: BulkEpisodeRow, services: Services, onCheckpoint: (row: BulkEpisodeRow) => void): Promise<BulkEpisodeRow> {
  if (row.status === "done" || row.uncertainCreation) return row;
  let current: BulkEpisodeRow = { ...row, error: undefined };
  const patch = (values: Partial<BulkEpisodeRow>) => { current = { ...current, ...values }; onCheckpoint(current); };
  try {
    if (!current.episodeId) {
      patch({ status: "creating" });
      try {
        const episode = await services.create(current);
        patch({ episodeId: episode.id });
      } catch (error) {
        // A rejected API response is definitive; a transport failure may have committed.
        if (!(error instanceof BulkApiError)) patch({ uncertainCreation: true });
        throw error;
      }
    }
    if (current.file && !current.completed) {
      patch({ status: "uploading" });
      const completed = await services.upload(current, patch);
      patch({ completed, progress: 100 });
    }
    patch({ status: "attaching" });
    // Also reconciles a previous attachment whose HTTP response was lost.
    const links = await services.links(current.episodeId!);
    const alreadyAttached = links.some((link) => current.completed
      ? link.objectKey === current.completed.objectKey
      : link.url === current.url.trim() && link.quality === current.quality);
    if (!alreadyAttached) await services.attach(current);
    patch({ status: "done", progress: 100 });
  } catch (error) {
    patch({ status: "error", error: error instanceof Error ? error.message : "Could not process episode." });
  }
  return current;
}

export class BulkApiError extends Error {}
