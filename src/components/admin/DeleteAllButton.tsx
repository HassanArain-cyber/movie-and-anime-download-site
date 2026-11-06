"use client";
import { useEffect, useRef, useState } from "react";
export default function DeleteAllButton({ kind, disabled, refresh, onBusyChange }: {
  kind: "comments" | "requests"; disabled: boolean; refresh: () => Promise<boolean>; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const removeAll = async () => {
    if (disabled || lock.current || !confirm(`Are you sure you want to permanently delete all ${kind}?`)) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice("");
    try {
      const response = await fetch(kind === "comments" ? "/api/admin/comments" : "/api/contact/requests", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not delete all ${kind}.`);
      setNotice(`Deleted ${data.deleted} ${kind}.`);
      if (!await refresh().catch(() => false)) setError("Deletion completed, but the list could not be refreshed. Use Refresh to verify the current list.");
    } catch (reason) {
      // A lost response may follow a committed delete. Refresh to reconcile;
      // never silently retry a destructive request or claim it was rolled back.
      const refreshed = await refresh().catch(() => false);
      setError(`${reason instanceof Error ? reason.message : `Could not confirm deletion of all ${kind}.`} ${refreshed ? "List refreshed; review it before retrying." : "Could not refresh the list. Use Refresh to verify before retrying."}`);
    } finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <button type="button" disabled={disabled || busy} onClick={() => void removeAll()} className="min-h-9 rounded-md border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:cursor-wait disabled:opacity-50">{busy ? "Deleting…" : "Delete All"}</button>
    <span className="text-[11px] text-neutral-500">{kind === "comments" ? "All comments and replies, across every filter/page." : "All requests, not just the visible list."} Cannot be undone.</span>
    {busy && <p role="status" className="basis-full text-xs text-purple-300">Deleting all {kind}… Please keep this page open.</p>}
    {notice && <p role="status" className="basis-full text-xs text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="basis-full break-words text-xs text-red-300">{error}</p>}
  </div>;
}
