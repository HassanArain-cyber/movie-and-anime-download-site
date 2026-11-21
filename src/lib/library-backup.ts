import { calendarFollowKey, parseCalendarFollows, type CalendarFollow } from "./calendar-follows";
import { isWatchStatus, type WatchStatus } from "./watch-status";

/** A portable, user-owned backup. Never put subscriber cookies or credentials in it. */
export const BACKUP_FORMAT = "vault-library-backup";
export const BACKUP_VERSION = 1;
export const WATCHED_EPISODES_KEY = "vault-watched-episodes-v1";
export const CONTINUE_EPISODES_KEY = "vault-continue-episodes-v1";
export const MAX_BACKUP_BYTES = 512 * 1024;

export type SavedVaultFollow = { id: number; watchStatus: WatchStatus };
export type SavedContinueEpisode = {
  mediaId: number;
  title: string;
  href: string;
  episodeNumber: number;
  posterUrl: string | null;
  totalEpisodes?: number;
  updatedAt: number;
};
export type WatchedEpisodeMap = Record<string, number[]>;
export type LibraryBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  vaultFollows: SavedVaultFollow[];
  calendarFollows: CalendarFollow[];
  watchedEpisodes: WatchedEpisodeMap;
  continueWatching: SavedContinueEpisode[];
};

const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

function safePoster(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function cleanVaultFollows(value: unknown): SavedVaultFollow[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<number, SavedVaultFollow>();
  for (const entry of value.slice(0, 500)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (positiveId(row.id) && isWatchStatus(row.watchStatus)) {
      unique.set(row.id, { id: row.id, watchStatus: row.watchStatus });
    }
  }
  return [...unique.values()];
}

export function cleanWatchedEpisodes(value: unknown): WatchedEpisodeMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean: WatchedEpisodeMap = {};
  for (const [id, episodes] of Object.entries(value).slice(0, 500)) {
    if (!/^[1-9]\d{0,9}$/.test(id) || !positiveId(Number(id)) || !Array.isArray(episodes)) continue;
    const valid = episodes.slice(0, 5000).filter(positiveId);
    if (valid.length) clean[id] = [...new Set(valid)];
  }
  return clean;
}

export function cleanContinueWatching(value: unknown): SavedContinueEpisode[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<number, SavedContinueEpisode>();
  for (const entry of value.slice(0, 12)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (!positiveId(row.mediaId) || !positiveId(row.episodeNumber) ||
      typeof row.title !== "string" || row.title.length > 255 ||
      typeof row.href !== "string" ||
      !/^\/(anime|series)\/[a-zA-Z0-9_-]+#episode-\d+$/.test(row.href) ||
      typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt)) continue;
    unique.set(row.mediaId, {
      mediaId: row.mediaId, title: row.title, href: row.href,
      episodeNumber: row.episodeNumber, posterUrl: safePoster(row.posterUrl),
      updatedAt: row.updatedAt,
      ...(positiveId(row.totalEpisodes) ? { totalEpisodes: row.totalEpisodes } : {}),
    });
  }
  return [...unique.values()];
}

export function createLibraryBackup(input: {
  vaultFollows: unknown;
  calendarFollows: unknown;
  watchedEpisodes: unknown;
  continueWatching: unknown;
}): LibraryBackup {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(),
    vaultFollows: cleanVaultFollows(input.vaultFollows),
    calendarFollows: parseCalendarFollows(JSON.stringify(input.calendarFollows)),
    watchedEpisodes: cleanWatchedEpisodes(input.watchedEpisodes),
    continueWatching: cleanContinueWatching(input.continueWatching),
  };
}

/** Reject unrelated or oversized files before reading anything into browser storage. */
export function parseLibraryBackup(raw: string): LibraryBackup {
  if (!raw || raw.length > MAX_BACKUP_BYTES) throw new Error("Backup is too large or empty.");
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("This is not a valid JSON backup."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("This file is not a Vault library backup.");
  }
  const data = value as Record<string, unknown>;
  if (data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION ||
    !Array.isArray(data.vaultFollows) || !Array.isArray(data.calendarFollows) ||
    !data.watchedEpisodes || typeof data.watchedEpisodes !== "object" ||
    !Array.isArray(data.continueWatching)) {
    throw new Error("Unsupported Vault backup version or missing fields.");
  }
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    vaultFollows: cleanVaultFollows(data.vaultFollows),
    calendarFollows: parseCalendarFollows(JSON.stringify(data.calendarFollows)),
    watchedEpisodes: cleanWatchedEpisodes(data.watchedEpisodes),
    continueWatching: cleanContinueWatching(data.continueWatching),
  };
}

/** Import merges instead of deleting data saved on the current device. */
export function mergeLibraryBackup(current: LibraryBackup, incoming: LibraryBackup): LibraryBackup {
  const calendar = new Map<string, CalendarFollow>();
  for (const item of [...current.calendarFollows, ...incoming.calendarFollows]) {
    calendar.set(calendarFollowKey(item), item);
  }
  if (calendar.size > 300) throw new Error("Too many calendar follows to merge (maximum 300).");

  const watched: WatchedEpisodeMap = { ...current.watchedEpisodes };
  for (const [mediaId, ids] of Object.entries(incoming.watchedEpisodes)) {
    watched[mediaId] = [...new Set([...(watched[mediaId] ?? []), ...ids])].slice(0, 5000);
  }
  const recentlyOpened = new Map<number, SavedContinueEpisode>();
  for (const episode of [...current.continueWatching, ...incoming.continueWatching]) {
    const previous = recentlyOpened.get(episode.mediaId);
    if (!previous || episode.updatedAt >= previous.updatedAt) recentlyOpened.set(episode.mediaId, episode);
  }
  return createLibraryBackup({
    vaultFollows: [...current.vaultFollows, ...incoming.vaultFollows],
    calendarFollows: [...calendar.values()],
    watchedEpisodes: watched,
    continueWatching: [...recentlyOpened.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12),
  });
}
