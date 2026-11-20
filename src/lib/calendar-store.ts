import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "@/db";
import { ApiError, imageUrl, positiveId, text } from "@/lib/validation";
import { readManualCalendarEntries, type CalendarKind, type ManualCalendarEntry } from "@/lib/calendar-model";

export const CALENDAR_KEY = "release_calendar_manual_v1";
const LIMIT = 250;

function optionalLink(value: unknown): string | null {
  const raw = text(value, "Link", 1200);
  if (!raw) return null;
  if (/^\/(anime|series|movie)\/[a-z0-9-]+(?:#episode-\d+)?$/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.href;
  } catch { /* invalid URL */ }
  throw new ApiError(400, "Link must be a public HTTPS URL or a Vault title URL");
}

export function validateCalendarEntry(body: Record<string, unknown>, id = randomUUID()): ManualCalendarEntry {
  const title = text(body.title, "Anime title", 160, true)!;
  const kind = body.kind;
  if (!["episode", "new-series", "movie", "special"].includes(String(kind))) {
    throw new ApiError(400, "Choose Episode, New series, Movie or Special");
  }
  if (typeof body.airingAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.airingAt)) {
    throw new ApiError(400, "Choose a valid release date and time");
  }
  const timestamp = Date.parse(body.airingAt);
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2020, 0, 1) || timestamp >= Date.UTC(2101, 0, 1)) {
    throw new ApiError(400, "Release time must be between 2020 and 2100");
  }
  const episode = body.episode === null || body.episode === undefined || body.episode === ""
    ? null : positiveId(body.episode, "Episode");
  if (kind !== "episode" && episode !== null) throw new ApiError(400, "Only episode releases may have an episode number");
  const anilistId = body.anilistId === null || body.anilistId === undefined || body.anilistId === ""
    ? null : positiveId(body.anilistId, "AniList ID");
  return {
    id,
    title,
    kind: kind as CalendarKind,
    airingAt: new Date(timestamp).toISOString(),
    episode,
    anilistId,
    posterUrl: imageUrl(body.posterUrl, "Poster URL"),
    url: optionalLink(body.url),
    notes: text(body.notes, "Notes", 240),
  };
}

export async function getManualCalendarEntries(): Promise<ManualCalendarEntry[]> {
  const result = await pool.query<{ setting_value: string }>(
    "SELECT setting_value FROM site_settings WHERE setting_key = $1", [CALENDAR_KEY],
  );
  return readManualCalendarEntries(result.rows[0]?.setting_value ?? null);
}

export async function changeManualCalendarEntry(
  action: "create" | "update" | "delete",
  body: Record<string, unknown>,
): Promise<ManualCalendarEntry[]> {
  // The one site-settings row is locked to prevent concurrent admin edits
  // overwriting each other. No database migrations or published episode edits.
  const id = action === "create" ? null : text(body.id, "Entry ID", 36, true);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Invalid calendar entry ID");
  const payload = action === "delete" ? null : validateCalendarEntry(body, id ?? randomUUID());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO site_settings (setting_key, setting_value) VALUES ($1, '[]') ON CONFLICT (setting_key) DO NOTHING",
      [CALENDAR_KEY],
    );
    const current = await client.query<{ setting_value: string }>(
      "SELECT setting_value FROM site_settings WHERE setting_key = $1 FOR UPDATE", [CALENDAR_KEY],
    );
    const entries = readManualCalendarEntries(current.rows[0]?.setting_value ?? "[]");
    let next: ManualCalendarEntry[];
    if (action === "create") {
      if (entries.length >= LIMIT) throw new ApiError(409, "Calendar is full; remove unused entries first");
      next = [...entries, payload!];
    } else {
      if (!entries.some((entry) => entry.id === id)) throw new ApiError(404, "Calendar entry not found");
      next = action === "update"
        ? entries.map((entry) => entry.id === id ? payload! : entry)
        : entries.filter((entry) => entry.id !== id);
    }
    await client.query(
      "UPDATE site_settings SET setting_value = $2, updated_at = NOW() WHERE setting_key = $1",
      [CALENDAR_KEY, JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
