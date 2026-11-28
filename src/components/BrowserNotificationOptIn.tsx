"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useUpdates, type EpisodeNotification } from "./UpdatesProvider";

const PREF_KEY = "vault-browser-alerts-v1";
const SEEN_KEY = "vault-browser-alerts-seen-v1";
const CHANGE_EVENT = "vault-alert-setting-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(CHANGE_EVENT, callback); };
}
const enabledSnapshot = () => localStorage.getItem(PREF_KEY) === "yes";
const serverSnapshot = () => false;
const safeTarget = (url: string) => /^\/(anime|series|movie)\/[a-z0-9_-]+(?:#episode-\d+)?$/i.test(url) ? url : "/notifications";

async function displayNotification(item: EpisodeNotification) {
  const title = "Vault · " + item.title;
  const options: NotificationOptions = {
    body: "New episode available: Season " + item.seasonNumber + ", Episode " + item.episodeNumber,
    tag: "vault-episode-" + item.id,
    data: { url: safeTarget(item.url) },
  };
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  if (registration?.showNotification) {
    await registration.showNotification(title, options);
  } else if (typeof Notification !== "undefined") {
    const alert = new Notification(title, options);
    alert.onclick = () => { window.focus(); window.location.assign(safeTarget(item.url)); alert.close(); };
  }
}
function readSeen(): number[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(values) ? values.filter((x) => Number.isSafeInteger(x)).slice(-150) : [];
  } catch { return []; }
}
function saveSeen(items: number[]) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(items.slice(-150))); }
  catch { /* Storage may be disabled. */ }
}

export default function BrowserNotificationOptIn() {
  const { data } = useUpdates();
  const enabled = useSyncExternalStore(subscribe, enabledSnapshot, serverSnapshot);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [pushState, setPushState] = useState<"loading" | "unsupported" | "unavailable" | "off" | "on">("loading");
  const [pushKey, setPushKey] = useState("");
  const [pushPending, setPushPending] = useState(false);
  const [pushError, setPushError] = useState("");

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) ||
          typeof Notification === "undefined" || !window.isSecureContext) {
        if (active) setPushState("unsupported");
        return;
      }
      try {
        const response = await fetch("/api/push", { cache: "no-store", credentials: "same-origin" });
        const result = await response.json() as { configured?: boolean; publicKey?: string };
        if (!result.configured || !result.publicKey) { if (active) setPushState("unavailable"); return; }
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (active) {
          setPushKey(result.publicKey);
          setPushState(sub ? "on" : "off");
        }
      } catch { if (active) setPushState("unavailable"); }
    };
    void check();
    return () => { active = false; };
  }, []);

  const togglePush = async () => {
    if (pushPending || !pushKey || !data) return;
    setPushPending(true); setPushError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (pushState === "on") {
        if (current) {
          const response = await fetch("/api/push", {
            method: "DELETE", cache: "no-store", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: current.endpoint }),
          });
          if (!response.ok) throw Error("Could not disable background alerts. Please retry.");
          await current.unsubscribe();
        }
        setPushState("off");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw Error("Browser notification permission was not granted.");
        const padding = "=".repeat((4 - pushKey.length % 4) % 4);
        const raw = atob((pushKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
        const applicationServerKey = Uint8Array.from(raw, (char) => char.charCodeAt(0));
        const isNew = !current;
        const sub = current || await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey,
        });
        const response = await fetch("/api/push", {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!response.ok) {
          if (isNew) await sub.unsubscribe().catch(() => undefined);
          const result = await response.json().catch(() => ({})) as { error?: string };
          throw Error(result.error || "Could not save your push subscription.");
        }
        setPushState("on");
      }
    } catch (cause) {
      setPushError(cause instanceof Error ? cause.message : "Could not change background alerts.");
    } finally { setPushPending(false); }
  };
  const toggle = async () => {
    if (pending) return;
    if (enabled) {
      try { localStorage.removeItem(PREF_KEY); window.dispatchEvent(new Event(CHANGE_EVENT)); }
      catch { setError("Browser storage is not available."); }
      return;
    }
    if (typeof Notification === "undefined") { setError("Notifications are not available in this browser."); return; }
    setPending(true); setError("");
    try {
      // Only an explicit tap/click may request permission.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setError("Notification permission was not granted."); return; }
      saveSeen(data?.notifications.map((item) => item.id) ?? []);
      localStorage.setItem(PREF_KEY, "yes");
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch { setError("Unable to enable notifications in this browser."); }
    finally { setPending(false); }
  };

  useEffect(() => {
    if (!enabled || pushState === "on" || typeof Notification === "undefined" || Notification.permission !== "granted" || !data) return;
    const seen = new Set(readSeen());
    // Never replay the entire old inbox on first visit.
    if (localStorage.getItem(SEEN_KEY) === null) {
      saveSeen(data.notifications.map((item) => item.id));
      return;
    }
    const newlyObserved = data.notifications.filter((item) => !item.readAt && !seen.has(item.id)).slice(0, 3);
    const ids = [...seen, ...data.notifications.map((item) => item.id)];
    saveSeen(ids);
    for (const item of newlyObserved) void displayNotification(item).catch(() => undefined);
  }, [data, enabled, pushState]);

  return (
    <div className="mx-1 mb-2 rounded-xl border border-violet-400/15 bg-violet-500/[.07] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">Browser episode alerts</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">Optional · alerts for new Vault episodes while the site is open.</p>
        </div>
        <button type="button" aria-pressed={enabled} onClick={() => void toggle()} disabled={pending}
          className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-bold transition disabled:opacity-50 ${enabled ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200" : "border-purple-400/35 bg-violet-600/20 text-purple-200 hover:bg-violet-600/35"}`}>
          {enabled ? "On" : pending ? "Enabling…" : "Enable"}
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-violet-400/15 pt-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">Background alerts</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
            {pushState === "unavailable" ? "Available after server push setup." :
             pushState === "unsupported" ? "Not supported on this browser. Install the PWA if required." :
             pushState === "loading" ? "Checking availability…" :
             "Optional · notifications may arrive while the app is closed."}
          </p>
        </div>
        {(pushState === "on" || pushState === "off") &&
          <button type="button" aria-pressed={pushState === "on"} onClick={() => void togglePush()}
            disabled={pushPending || !data}
            className="min-h-10 shrink-0 rounded-lg border border-violet-400/30 px-3 text-xs font-bold text-violet-200 disabled:opacity-50">
            {pushPending ? "Saving…" : pushState === "on" ? "On" : "Enable"}
          </button>}
      </div>
      {pushError && <p role="alert" className="mt-2 text-[11px] text-amber-200">{pushError}</p>}
      {error && <p role="alert" className="mt-2 text-[11px] text-amber-200">{error}</p>}
    </div>
  );
}
