"use client";

import { useMemo, useSyncExternalStore } from "react";
import { CALENDAR_FOLLOWS_CHANGED, CALENDAR_FOLLOWS_KEY, parseCalendarFollows } from "@/lib/calendar-follows";

function subscribe(change: () => void) {
  window.addEventListener("storage", change);
  window.addEventListener(CALENDAR_FOLLOWS_CHANGED, change);
  return () => {
    window.removeEventListener("storage", change);
    window.removeEventListener(CALENDAR_FOLLOWS_CHANGED, change);
  };
}
function snapshot(): string {
  try { return localStorage.getItem(CALENDAR_FOLLOWS_KEY) ?? "[]"; }
  catch { return "[]"; }
}
export function useCalendarFollows() {
  const data = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return useMemo(() => parseCalendarFollows(data), [data]);
}
