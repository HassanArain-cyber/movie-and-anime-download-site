export type CalendarKind = "episode" | "new-series" | "movie" | "special";
export type CalendarSource = "anilist" | "manual" | "vault";
export type CalendarEvent = {
  id: string;
  title: string;
  kind: CalendarKind;
  airingAt: string;
  episode: number | null;
  totalEpisodes: number | null;
  posterUrl: string | null;
  url: string | null;
  source: CalendarSource;
  notes: string | null;
  anilistId: number | null;
};
export type ManualCalendarEntry = Omit<CalendarEvent, "totalEpisodes" | "source">;
export type CalendarResponse = {
  year: number;
  month: number;
  events: CalendarEvent[];
  anilistStatus: "ok" | "unavailable" | "partial" | "disabled";
  updatedAt: string;
  timeZone: string;
};

const TIME_ZONE = "Asia/Karachi";
export const CALENDAR_TIME_ZONE = TIME_ZONE;
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function calendarDay(iso: string): string {
  const parts = dayFormat.formatToParts(new Date(iso));
  const read = (part: string) => parts.find((item) => item.type === part)?.value ?? "";
  return [read("year"), read("month"), read("day")].join("-");
}

export function parseCalendarMonth(year: unknown, month: unknown, today = new Date()): { year: number; month: number } {
  const now = calendarDay(today.toISOString()).split("-").map(Number);
  if (year == null && month == null) return { year: now[0], month: now[1] };
  const y = Number(year), m = Number(month);
  if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error("Choose a valid calendar month between 2020 and 2100");
  }
  return { year: y, month: m };
}

export function calendarWindow(year: number, month: number): { start: Date; end: Date } {
  // Pad both boundaries for the PKT UTC+5 day conversion.
  return { start: new Date(Date.UTC(year, month - 1, 0, 0, 0)), end: new Date(Date.UTC(year, month, 2, 0, 0)) };
}

export function inCalendarMonth(event: CalendarEvent, year: number, month: number): boolean {
  const day = calendarDay(event.airingAt);
  return day.startsWith(String(year) + "-" + String(month).padStart(2, "0") + "-");
}

export function combineCalendarEvents(source: CalendarEvent[], manual: ManualCalendarEntry[], year: number, month: number): CalendarEvent[] {
  const entries = new Map<string, CalendarEvent>();
  for (const event of source) {
    if (!inCalendarMonth(event, year, month)) continue;
    const key = event.anilistId != null && event.episode != null
      ? "anilist:" + event.anilistId + ":" + event.episode
      : event.id;
    entries.set(key, event);
  }
  // An admin record with an AniList ID and episode deliberately overrides that
  // airing episode. The original event is replaced, not shown twice.
  for (const event of manual) {
    const complete: CalendarEvent = { ...event, totalEpisodes: null, source: "manual" };
    if (!inCalendarMonth(complete, year, month)) continue;
    if (event.anilistId != null && event.episode != null) {
      entries.delete("anilist:" + event.anilistId + ":" + event.episode);
    }
    entries.set("manual:" + event.id, complete);
  }
  return [...entries.values()].sort((a, b) =>
    a.airingAt.localeCompare(b.airingAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function readManualCalendarEntries(raw: string | null): ManualCalendarEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 300).filter((event): event is ManualCalendarEntry => {
      if (!event || typeof event !== "object") return false;
      const row = event as Record<string, unknown>;
      return typeof row.id === "string" && /^[a-f0-9-]{36}$/i.test(row.id)
        && typeof row.title === "string" && row.title.length > 0 && row.title.length <= 160
        && ["episode", "new-series", "movie", "special"].includes(String(row.kind))
        && typeof row.airingAt === "string" && Number.isFinite(Date.parse(row.airingAt))
        && (row.episode === null || (Number.isInteger(row.episode) && Number(row.episode) > 0))
        && (row.posterUrl === null || typeof row.posterUrl === "string")
        && (row.url === null || typeof row.url === "string")
        && (row.notes === null || typeof row.notes === "string")
        && (row.anilistId === null || (Number.isInteger(row.anilistId) && Number(row.anilistId) > 0));
    });
  } catch { return []; }
}
