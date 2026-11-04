/**
 * Compact, locale-stable timestamp for public comment metadata.
 *
 * `en-US` keeps the requested "Nov 4, 2026 · 9:45 AM" shape (short month,
 * four-digit year, 12-hour clock). The viewer's local timezone is used by
 * default; an explicit timeZone is accepted for deterministic tests.
 */
export function formatCommentTimestamp(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (timeZone) options.timeZone = timeZone;
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")} · ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}
