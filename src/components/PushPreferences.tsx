"use client";
import { useEffect, useState } from "react";
import { updatesRequest, useUpdates } from "./UpdatesProvider";
function applicationKey(key: string): ArrayBuffer {
  const text = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;
}
export default function PushPreferences() {
  const { data, refresh } = useUpdates();
  const [support, setSupport] = useState<"checking" | "supported" | "unsupported">("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSupport(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "supported" : "unsupported");
      if ("Notification" in window) setPermission(Notification.permission);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const enable = async () => {
    if (!data?.publicKey || support !== "supported") return;
    setBusy(true); setMessage("");
    try {
      // Permission is requested immediately in this explicit click handler, not
      // during page load, polling, registration or other async side effects.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") { setMessage(granted === "denied" ? "Notifications are blocked. Change this site's permission in your browser settings, then try again." : "Permission was not granted. In-site alerts remain available."); return; }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      // Await activation, but do not leave the controls spinning forever.
      await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Service worker activation timed out. Reload and try again.")), 15000))]);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const current = subscription.options.applicationServerKey;
        if (current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== data.publicKey) {
          await subscription.unsubscribe(); subscription = null;
        }
      }
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(data.publicKey) });
      await updatesRequest("/api/push-subscription", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      await refresh(); setMessage("Browser push enabled for titles you follow.");
    } catch (e) { setMessage((e as Error).message || "Could not enable push. In-site alerts still work."); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); setMessage("");
    try {
      // Revoke server delivery first. If browser unsubscribe fails, delivery is
      // already disabled and in-site notification history is untouched.
      await updatesRequest("/api/push-subscription", { method: "DELETE" });
      if ("serviceWorker" in navigator) {
        try { const registration = await navigator.serviceWorker.getRegistration("/"); await (await registration?.pushManager.getSubscription())?.unsubscribe(); }
        catch { /* Server revocation is authoritative; retain the PWA worker. */ }
      }
      await refresh(); setMessage("Push disabled. Your follows and in-site history are unchanged.");
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section aria-labelledby="push-preferences" className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5">
    <h2 id="push-preferences" className="font-semibold text-white">Notification preferences</h2>
    <p className="text-sm text-neutral-400">In-site episode alerts are always saved for titles you follow. Browser push is optional and applies only to this browser.</p>
    <p className="text-sm">Browser push: <strong>{data?.pushEnabled ? "Enabled" : "Disabled"}</strong></p>
    {support === "unsupported" && <p className="text-xs text-amber-200">Push needs HTTPS and a supported browser. On iPhone/iPad, add the site to your Home Screen first. You can still use in-site alerts here.</p>}
    {data && !data.publicKey && <p className="text-xs text-amber-200">The site owner has not configured browser push yet. In-site alerts still work.</p>}
    {permission === "denied" && <p className="text-xs text-amber-200">Push permission is blocked. Allow notifications for this site in browser settings before enabling.</p>}
    <div className="flex flex-wrap gap-3">
      {!data?.pushEnabled ? <button type="button" disabled={busy || !data?.publicKey || support !== "supported"} onClick={() => void enable()} className="min-h-11 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Enabling…" : "Enable browser push"}</button> : <>
        <button disabled={busy} onClick={() => void disable()} className="min-h-11 rounded-lg border border-neutral-600 px-4 text-sm disabled:opacity-40">{busy ? "Saving…" : "Disable browser push"}</button>
        <button disabled={busy || support !== "supported"} onClick={() => void enable()} className="min-h-11 text-sm text-purple-300 disabled:opacity-40">Repair browser subscription</button>
      </>}
    </div>
    {message && <p role="status" className="break-words text-sm text-purple-200">{message}</p>}
    <p className="text-xs leading-relaxed text-neutral-500">Supported Android browsers can receive push when the site is closed. OS battery restrictions, force-stopping a browser, lack of connectivity or provider delays can prevent or delay delivery. Clearing site data removes this anonymous browser identity; there is no cross-device sync.</p>
  </section>;
}
