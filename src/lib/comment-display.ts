/**
 * Compact, locale-stable timestamp for public comment metadata.
 *
 * `en-US` keeps the requested "Nov 4 · 9:45 AM" shape (short month,
 * 12-hour clock). The four-digit year is shown only when the comment's
 * calendar year differs from the current calendar year, e.g.
 * "Nov 4, 2026 · 9:45 AM". Year comparison uses the same viewer timezone
 * as the displayed date, so New Year boundary comments stay correct.
 *
 * `timeZone` and `now` are optional test seams; the UI passes only `value`.
 */
export function formatCommentTimestamp(value: string, timeZone?: string, now: Date = new Date()): string {
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

  const yearOptions: Intl.DateTimeFormatOptions = { year: "numeric" };
  if (timeZone) yearOptions.timeZone = timeZone;
  const currentYear = new Intl.DateTimeFormat("en-US", yearOptions).format(now);
  const commentYear = get("year");
  const datePart = commentYear === currentYear
    ? `${get("month")} ${get("day")}`
    : `${get("month")} ${get("day")}, ${commentYear}`;
  return `${datePart} · ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}
