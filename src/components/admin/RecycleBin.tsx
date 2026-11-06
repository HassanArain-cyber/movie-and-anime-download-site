"use client";
import { useCallback, useEffect, useState } from "react";
type Item = { kind: "media" | "season" | "episode"; id: number; title: string; type: string; deletedAt: string };
const button = "min-h-10 rounded-md border border-neutral-700 px-3 py-2 text-xs disabled:opacity-40";
export default function RecycleBin({ onBusyChange }: { onBusyChange: (value: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([]), [total, setTotal] = useState(0), [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async (offset = 0) => {
    const response = await fetch(`/api/admin/recycle-bin?offset=${offset}`, { cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load Recycle Bin");
    setReady(data.ready); setTotal(data.total); setItems((current) => offset ? [...current, ...data.items] : data.items);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/recycle-bin", { cache: "no-store", signal: controller.signal }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load bin"); return data; }).then((data) => { if (!controller.signal.aborted) { setReady(data.ready); setTotal(data.total); setItems(data.items); } }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, []);
  const action = async (operation: "restore" | "purge" | "empty", item?: Item) => {
    const confirmation = operation === "empty" ? "EMPTY RECYCLE BIN" : item ? `DELETE PERMANENTLY ${item.kind}:${item.id}` : "";
    if (operation !== "restore" && prompt(`This permanently deletes database content, including children, comments and links. It cannot be undone. Physical R2 files are retained. Type ${confirmation} to continue.`) !== confirmation) return;
    setBusy(true); onBusyChange(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/recycle-bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: operation, kind: item?.kind, id: item?.id, confirmation }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Operation failed");
      setNotice(operation === "restore" ? "Restored. Independently deleted children stay in the Recycle Bin; restore them separately." : "Database content permanently deleted. Physical R2 files and upload history retained.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Operation failed"); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <section aria-label="Recycle Bin" className="min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Recycle Bin <span className="text-sm text-neutral-500">({total})</span></h2><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void load().catch((reason) => setError(String(reason)))} className={button}>Refresh bin</button><button disabled={busy || !total || !ready} onClick={() => void action("empty")} className={`${button} border-red-900 text-red-300`}>Empty Recycle Bin</button></div></div>
    <p className="text-xs text-neutral-400">Restore parent titles before seasons, and seasons before episodes. Deleting a parent retains its children for recovery. Independently deleted children remain in the bin. Permanent deletion never removes physical R2 objects.</p>
    {!ready && <p role="status" className="text-sm text-amber-300">Migration 0008 is not installed. Existing content is safe; ask the operator to install the additive Preview migration before using the bin.</p>}
    {error && <p role="alert" className="break-words text-sm text-red-300">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {ready && !items.length && <p className="rounded-lg border border-dashed border-neutral-800 p-3 text-sm text-neutral-500">Recycle Bin is empty.</p>}
    <div className="space-y-2">{items.map((item) => <article key={`${item.kind}:${item.id}`} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"><h3 className="break-words text-sm font-medium">{item.title || `${item.kind} #${item.id}`}</h3><p className="mt-1 text-xs text-neutral-500">{item.kind === "media" ? item.type : item.kind} · #{item.id} · Deleted {new Date(item.deletedAt).toLocaleString()}</p><div className="mt-2 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void action("restore", item)} aria-label={`Restore ${item.title}`} className={`${button} border-purple-500/40 text-purple-200`}>Restore</button><button disabled={busy} onClick={() => void action("purge", item)} aria-label={`Permanently delete ${item.title}`} className={`${button} border-red-900 text-red-300`}>Delete permanently</button></div></article>)}</div>
    {items.length < total && <button disabled={busy} className={button} onClick={() => void load(items.length).catch((reason) => setError(String(reason)))}>Load more deleted items</button>}
  </section>;
}
