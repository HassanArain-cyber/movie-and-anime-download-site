"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WatchStatus } from "@/lib/watch-status";
export type FollowedTitle = { id: number; title: string; type: string; slug: string; posterUrl: string | null; hasNew: boolean; watchStatus: WatchStatus };
export type EpisodeNotification = { id: number; mediaId: number; title: string; episodeNumber: number; episodeTitle: string | null; seasonNumber: number; url: string; readAt: string | null; createdAt: string };
export type Updates = { following: FollowedTitle[]; unread: number; notifications: EpisodeNotification[]; hasMore: boolean };
export async function updatesRequest<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", ...init?.headers } });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Could not save changes. Please try again.");
  return result;
}
let bootstrap: Promise<Updates> | undefined;
function initialize() {
  if (!bootstrap) {
    // Web Locks prevents two first-load tabs from replacing each other's identity.
    const load = () => updatesRequest<Updates>("/api/updates");
    const lockedLoad = async (): Promise<Updates> => {
      if (typeof navigator !== "undefined" && navigator.locks) return await navigator.locks.request("vault-subscriber-init", load);
      return load();
    };
    bootstrap = lockedLoad().catch((error) => { bootstrap = undefined; throw error; });
  }
  return bootstrap!;
}
type Context = { data: Updates | null; error: string; refresh: () => Promise<void>; follow: (id: number, following: boolean) => Promise<number>; setStatus: (id: number, status: WatchStatus) => Promise<void>; markRead: (id?: number) => Promise<void> };
const UpdatesContext = createContext<Context | null>(null);
export function useUpdates() { const value = useContext(UpdatesContext); if (!value) throw new Error("UpdatesProvider missing"); return value; }
export default function UpdatesProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Updates | null>(null), [error, setError] = useState("");
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const task = updatesRequest<Updates>("/api/updates").then((next) => { setData(next); setError(""); }).catch((e: Error) => { setError(e.message); });
    inflight.current = task;
    await task;
    inflight.current = null;
  }, []);
  useEffect(() => {
    let active = true;
    void initialize().then((next) => { if (active) { setData(next); setError(""); } }).catch((e: Error) => { if (active) setError(e.message); });
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  const follow = async (id: number, following: boolean) => {
    const saved = await updatesRequest<{ followerCount: number }>("/api/follows", { method: following ? "POST" : "DELETE", body: JSON.stringify({ mediaId: id }) });
    await inflight.current;
    await refresh();
    return saved.followerCount;
  };
  const setStatus = async (id: number, status: WatchStatus) => {
    await updatesRequest("/api/follows", { method: "PATCH", body: JSON.stringify({ mediaId: id, watchStatus: status }) });
    // Reflect a successful save even if a background refresh was already in flight.
    await inflight.current;
    setData((current) => current ? { ...current, following: current.following.map((item) => item.id === id ? { ...item, watchStatus: status } : item) } : current);
  };
  const markRead = async (id?: number) => {
    await updatesRequest("/api/notifications", { method: "PATCH", keepalive: true, body: JSON.stringify(id ? { id } : { all: true }) });
    await inflight.current;
    await refresh();
  };
  return <UpdatesContext.Provider value={{ data, error, refresh, follow, setStatus, markRead }}>{children}</UpdatesContext.Provider>;
}
