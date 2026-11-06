export const WATCH_STATUSES = [
  { value: "plan_to_watch", label: "Plan to Watch" },
  { value: "watching", label: "Watching" },
  { value: "continue", label: "Continue" },
  { value: "on_hold", label: "On-Hold" },
  { value: "watched", label: "Watched" },
] as const;
export type WatchStatus = typeof WATCH_STATUSES[number]["value"];
export function isWatchStatus(value: unknown): value is WatchStatus {
  return typeof value === "string" && WATCH_STATUSES.some((status) => status.value === value);
}
