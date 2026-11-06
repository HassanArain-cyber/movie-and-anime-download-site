"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { episodeFolders, type BinItem, type BinSeason } from "@/lib/recycle-bin-view";
const button = "min-h-9 shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs transition-colors hover:bg-neutral-800 disabled:opacity-40";
type Tab = "All" | "Titles" | "Episodes";
async function readBin(signal?: AbortSignal) {
  // Read paged metadata to avoid splitting one folder across 100-item pages.
  // Episode rows are mounted only when both ancestor folders are expanded.
  const entries = new Map<string, BinItem>(); let offset = 0, ready = true, total = 0;
  do {
    const response = await fetch(`/api/admin/recycle-bin?offset=${offset}`, { cache: "no-store", signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load Recycle Bin");
    ready = data.ready; total = data.total;
    for (const item of data.items as BinItem[]) entries.set(`${item.kind}:${item.id}`, item);
    offset += data.items.length;
    if (!data.items.length) break;
  } while (offset < total);
  return { items: [...entries.values()], ready, total };
}
async function writeBin(action: string, item?: BinItem, confirmation?: string) {
  const response = await fetch("/api/admin/recycle-bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, kind: item?.kind, id: item?.id, confirmation }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Operation failed");
}
export default function RecycleBin({ onBusyChange }: { onBusyChange: (value: boolean) => void }) {
  const [items, setItems] = useState<BinItem[]>([]), [total, setTotal] = useState(0), [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState<Tab>("All"), [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lock = useRef(false);
  const apply = useCallback((data: Awaited<ReturnType<typeof readBin>>) => { setItems(data.items); setTotal(data.total); setReady(data.ready); setStale(false); }, []);
  useEffect(() => {
    const controller = new AbortController();
    readBin(controller.signal).then((data) => { if (!controller.signal.aborted) apply(data); }).catch((reason) => { if (!controller.signal.aborted) { setError(String(reason)); setStale(true); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apply]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const refresh = async () => {
    if (lock.current || loading) return;
    lock.current = true; setLoading(true); setError("");
    try { apply(await readBin()); } catch (reason) { setStale(true); setError(`${reason instanceof Error ? reason.message : "Could not load bin"}. Refresh bin to continue.`); }
    finally { lock.current = false; setLoading(false); }
  };
  const action = async (operation: "restore" | "purge" | "empty", item?: BinItem, season?: BinSeason) => {
    if (lock.current || loading || stale) return;
    const confirmation = operation === "empty" ? "EMPTY RECYCLE BIN" : item ? `DELETE PERMANENTLY ${item.kind}:${item.id}` : "";
    if (operation !== "restore" && prompt(`This permanently deletes database content, including children, comments and links. It cannot be undone. Physical R2 files are retained. Type ${confirmation} to continue.`) !== confirmation) return;
    if (season && !confirm(`Restore all ${season.items.length} deleted episodes in ${season.items[0].mediaTitle}, Season ${season.number ?? "unknown"}? Parents must be active. Only these explicitly selected episodes will be restored.`)) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice(""); let restored = 0;
    try {
      if (season) {
        // Reuse the existing parent-aware restore endpoint; stop on the first
        // failure, never bypass parent rules or silently revive other children.
        for (const episode of season.items) { await writeBin("restore", episode); restored++; setNotice(`Restoring ${restored} / ${season.items.length} episodes… Keep this page open.`); }
        setNotice(`Restored ${restored} episodes. Other seasons and independently deleted items were not changed.`);
      } else {
        await writeBin(operation, item, confirmation);
        setNotice(operation === "restore" ? "Restored. Independently deleted children stay in the Recycle Bin; restore them separately." : "Database content permanently deleted. Physical R2 files and upload history retained.");
      }
    } catch (reason) { setError(`${season ? `${restored} restored; stopped safely. ` : ""}${reason instanceof Error ? reason.message : "Operation failed"}`); }
    finally {
      try { apply(await readBin()); } catch { setStale(true); setError((current) => `${current ? `${current} ` : ""}Could not refresh the bin; use Refresh bin before retrying.`); }
      lock.current = false; setBusy(false); onBusyChange(false);
    }
  };
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const folders = episodeFolders(items), titles = items.filter((item) => item.kind !== "episode"), episodeCount = items.length - titles.length;
  const disabled = busy || loading || stale;
  const row = (item: BinItem, episode = false) => <article key={`${item.kind}:${item.id}`} data-testid="bin-item-row" className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-neutral-800/60 px-2 py-1.5 last:border-0">
    <div className="min-w-0 flex-1 basis-28"><h3 className="break-words text-xs font-medium text-neutral-200">{episode ? `Episode ${item.episodeNumber ?? item.id}${item.episodeTitle && item.episodeTitle !== `Episode ${item.episodeNumber}` ? ` · ${item.episodeTitle}` : ""}` : item.title || `${item.kind} #${item.id}`}</h3><p className="text-[11px] text-neutral-500">{episode ? "" : `${item.kind === "media" ? item.type : "season"} · `}#{item.id} · <time dateTime={item.deletedAt} title={new Date(item.deletedAt).toLocaleString()}>{new Date(item.deletedAt).toLocaleDateString()}</time></p></div>
    <div className="flex flex-wrap gap-1"><button disabled={disabled} onClick={() => void action("restore", item)} aria-label={`Restore ${item.title}`} className={`${button} border-purple-500/30 text-purple-200`}>Restore</button><button disabled={disabled} onClick={() => void action("purge", item)} aria-label={`Permanently delete ${item.title}`} className={`${button} border-red-900/60 text-red-300`}>Delete permanently</button></div>
  </article>;
  return <section aria-label="Recycle Bin" className="min-w-0 space-y-2" aria-busy={busy || loading}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Recycle Bin <span className="font-normal text-neutral-500">({total})</span></h2><div className="flex flex-wrap gap-1"><button disabled={busy || loading} onClick={() => void refresh()} className={button}>Refresh bin</button><button disabled={disabled || !total || !ready} onClick={() => void action("empty")} className={`${button} border-red-900 text-red-300`}>Empty Recycle Bin</button></div></div>
    <div role="group" aria-label="Recycle Bin filters" className="flex gap-1">{(["All", "Titles", "Episodes"] as Tab[]).map((value) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)} className={`${button} ${tab === value ? "border-purple-500/50 bg-purple-500/15 text-purple-200" : "text-neutral-400"}`}>{value} <span className="text-[11px] text-neutral-500">{value === "All" ? items.length : value === "Titles" ? titles.length : episodeCount}</span></button>)}</div>
    <details className="text-xs text-neutral-500"><summary className="min-h-9 cursor-pointer py-2">Recovery rules &amp; storage safety</summary><p className="pb-2">Restore parent titles before seasons, and seasons before episodes. Independently deleted children stay in the bin until explicitly restored. Permanent deletion cannot be undone. Physical R2 files and upload history are always retained.</p></details>
    {!ready && <p role="status" className="text-xs text-amber-300">Migration 0008 is not installed. Existing content is safe; ask the operator to install the additive Preview migration before using the bin.</p>}
    {loading && <p role="status" className="text-xs text-neutral-400">Loading bin…</p>}{error && <p role="alert" className="break-words text-xs text-red-300">{error}</p>}{notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}
    {ready && !loading && !error && !(tab === "Titles" ? titles.length : tab === "Episodes" ? episodeCount : items.length) && <p className="rounded-md border border-dashed border-neutral-800 p-2 text-xs text-neutral-500">{!items.length ? "Recycle Bin is empty." : `No deleted ${tab.toLowerCase()}.`}</p>}
    {tab !== "Episodes" && titles.length > 0 && <div aria-label="Deleted titles and seasons" className="overflow-hidden rounded-md border border-neutral-800">{titles.map((item) => row(item))}</div>}
    {tab !== "Titles" && <div aria-label="Deleted episode folders" className="space-y-1">{folders.map((folder) => {
      const open = expanded.has(folder.key);
      return <div key={folder.key} className="min-w-0 overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/30" data-testid="bin-title-folder">
        <button type="button" aria-expanded={open} aria-controls={`bin-title-${folder.key}`} onClick={() => toggle(folder.key)} className="flex min-h-10 w-full items-center gap-2 px-2 py-2 text-left text-xs hover:bg-purple-500/5"><span aria-hidden="true" className={`text-purple-400 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>▸</span><span title={folder.title} className="min-w-0 flex-1 line-clamp-2 break-words font-medium">{folder.title}</span><span className="shrink-0 text-[11px] text-neutral-500">{folder.count} deleted {folder.count === 1 ? "episode" : "episodes"}</span></button>
        {open && <div id={`bin-title-${folder.key}`} className="border-t border-neutral-800 pl-2">{folder.seasons.map((season) => {
          const seasonOpen = expanded.has(season.key), blocked = season.items.some((item) => item.parentDeleted);
          return <div key={season.key} data-testid="bin-season-folder" className="border-b border-neutral-800/60 last:border-0"><button type="button" aria-expanded={seasonOpen} aria-controls={`bin-season-${season.key}`} onClick={() => toggle(season.key)} className="flex min-h-10 w-full items-center gap-2 px-2 py-2 text-left text-xs hover:bg-purple-500/5"><span aria-hidden="true" className={`text-purple-400 transition-transform motion-reduce:transition-none ${seasonOpen ? "rotate-90" : ""}`}>▸</span><span className="flex-1">Season {season.number ?? "unknown"}</span><span className="text-[11px] text-neutral-500">{season.items.length} deleted</span></button>
            {seasonOpen && <div id={`bin-season-${season.key}`} className="border-t border-neutral-800/60"><div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1"><p className="text-[11px] text-neutral-500">{blocked ? "Restore parent title / season first." : "Restore only this season’s deleted episodes."}</p><button disabled={disabled || blocked} title={blocked ? "Restore parent title / season first" : undefined} onClick={() => void action("restore", undefined, season)} aria-label={`Restore all deleted episodes in ${folder.title}, Season ${season.number}`} className={`${button} border-purple-500/30 text-purple-200`}>Restore All</button></div>{season.items.map((item) => row(item, true))}</div>}
          </div>;
        })}</div>}
      </div>;
    })}</div>}
  </section>;
}
