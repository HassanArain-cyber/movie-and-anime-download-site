import type { CalendarEvent } from "@/lib/calendar-model";

export type CalendarFollow = {
  source: "anilist" | "jikan";
  externalId: number;
  title: string;
  posterUrl: string | null;
  addedAt: number;
};

export const CALENDAR_FOLLOWS_KEY = "vault-calendar-follows-v1";
export const CALENDAR_FOLLOWS_CHANGED = "vault-calendar-follows-changed";
const MAX_FOLLOWS = 300;

function safeId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}

export function calendarFollowIdentity(event: Pick<CalendarEvent, "source" | "anilistId" | "id">): string | null {
  if (safeId(event.anilistId)) return "anilist:" + event.anilistId;
  if (event.source !== "jikan") return null;
  const match = /^jikan:([1-9]\d{0,9}):\d{4}-\d{2}-\d{2}$/.exec(event.id);
  const id = match ? Number(match[1]) : NaN;
  return safeId(id) ? "jikan:" + id : null;
}

export function calendarFollowKey(item: CalendarFollow): string {
  return item.source + ":" + item.externalId;
}

function safePoster(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseCalendarFollows(raw: string | null): CalendarFollow[] {
  if (!raw || raw.length > 150000) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const unique = new Set<string>();
    const clean: CalendarFollow[] = [];
    for (const value of list.slice(0, MAX_FOLLOWS)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if ((row.source !== "anilist" && row.source !== "jikan") || !safeId(row.externalId)
        || typeof row.title !== "string" || !row.title.trim() || row.title.length > 200) continue;
      const key = row.source + ":" + row.externalId;
      if (unique.has(key)) continue;
      unique.add(key);
      clean.push({
        source: row.source, externalId: row.externalId, title: row.title.trim(),
        posterUrl: safePoster(row.posterUrl),
        addedAt: typeof row.addedAt === "number" && Number.isFinite(row.addedAt) ? row.addedAt : 0,
      });
    }
    return clean;
  } catch { return []; }
}

export function followFromEvent(event: CalendarEvent): CalendarFollow | null {
  const identity = calendarFollowIdentity(event);
  if (!identity || !event.title.trim()) return null;
  const [source, rawId] = identity.split(":");
  return {
    source: source as CalendarFollow["source"], externalId: Number(rawId),
    title: event.title.slice(0, 200).trim(), posterUrl: safePoster(event.posterUrl), addedAt: Date.now(),
  };
}

export function withCalendarFollow(entries: CalendarFollow[], item: CalendarFollow, shouldFollow: boolean): CalendarFollow[] {
  const key = calendarFollowKey(item);
  const without = entries.filter((entry) => calendarFollowKey(entry) !== key);
  if (!shouldFollow) return without;
  if (without.length >= MAX_FOLLOWS) throw new Error("You can follow up to 300 calendar anime on this device.");
  return [item, ...without];
}

export function updateCalendarFollow(item: CalendarFollow, following: boolean): void {
  try {
    const previous = parseCalendarFollows(localStorage.getItem(CALENDAR_FOLLOWS_KEY));
    const next = withCalendarFollow(previous, item, following);
    localStorage.setItem(CALENDAR_FOLLOWS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CALENDAR_FOLLOWS_CHANGED));
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith("You can follow") ? error.message : "Could not save your calendar follows in this browser.");
  }
}

export function calendarEventIsFollowed(
  event: CalendarEvent,
  saved: readonly CalendarFollow[],
  vaultFollowing: readonly { id: number; type: string; slug: string; externalSource?: string | null; externalId?: string | null }[],
): boolean {
  const identity = calendarFollowIdentity(event);
  if (identity && saved.some((entry) => calendarFollowKey(entry) === identity)) return true;
  if (typeof event.vaultMediaId === "number" && vaultFollowing.some((entry) => entry.id === event.vaultMediaId)) return true;
  if (identity?.startsWith("anilist:") && vaultFollowing.some((entry) =>
    entry.externalSource === "anilist" && entry.externalId === identity.slice(8))) return true;
  const path = event.url?.match(/^\/(anime|series|movie)\/([a-z0-9_-]+)(?:#episode-\d+)?$/i);
  return !!path && vaultFollowing.some((entry) => entry.type === path[1] && entry.slug === path[2]);
}
