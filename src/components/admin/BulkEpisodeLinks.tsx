"use client";

import { useEffect, useRef, useState } from "react";
import { LINK_BEHAVIORS, QUALITIES, qualityDisplay, websiteHost } from "@/lib/media-links";
import { episodeRange, qualityLinks, saveEpisodeQualityLink, validateEpisodeLink, type LinkResult } from "@/lib/episode-quality-batch";
import type { LinkBehavior, Media, MediaWithRelations, VideoQuality } from "@/lib/types";

const control = "min-h-10 w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white disabled:opacity-50";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function BulkEpisodeLinks({ onBusyChange, initialMediaId, onChanged }: { onBusyChange: (busy: boolean) => void; initialMediaId?: number; onChanged?: () => void | Promise<void> }) {
  const [titles, setTitles] = useState<Media[]>([]);
  const [mediaId, setMediaId] = useState(initialMediaId ? String(initialMediaId) : "");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteStart, setDeleteStart] = useState("13");
  const [deleteEnd, setDeleteEnd] = useState("22");
  const [newSeasonNumber, setNewSeasonNumber] = useState("1");
  const [newSeasonName, setNewSeasonName] = useState("");
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [seasonId, setSeasonId] = useState("");
  const [details, setDetails] = useState<MediaWithRelations | null>(null);
  const [quality, setQuality] = useState<VideoQuality>("720p");
  const [linkBehavior, setLinkBehavior] = useState<LinkBehavior>("open");
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("12");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, LinkResult>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<"selection" | "range" | "links">("selection");
  const [progress, setProgress] = useState("");
  const seasonForm = useRef<HTMLDetailsElement>(null);
  const lock = useRef(false);
  const loadGeneration = useRef(0);
  const season = details?.seasons?.find((entry) => entry.id === Number(seasonId));
  const episodes = [...(season?.episodes ?? [])].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const keyFor = (id: number) => `${id}:${quality}`;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      request<Media[]>("/api/media", { signal: controller.signal }),
      initialMediaId ? request<MediaWithRelations>(`/api/media/${initialMediaId}`, { signal: controller.signal }) : Promise.resolve(null),
    ]).then(([items, data]) => {
      if (controller.signal.aborted) return;
      setTitles(items.filter((item) => item.type !== "movie"));
      if (data) {
        setDetails(data); setSeasonId(String(data.seasons?.[0]?.id ?? ""));
        setNewSeasonNumber(String(Math.max(0, ...(data.seasons ?? []).map((entry) => entry.seasonNumber)) + 1));
      }
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialMediaId]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const selectTitle = async (value: string) => {
    const generation = ++loadGeneration.current;
    setSelectedIds([]); setOperation("selection"); setMediaId(value); setDetails(null); setSeasonId(""); setError(""); setNotice(""); setProgress("");
    if (!value) return;
    setLoading(true);
    try {
      const data = await request<MediaWithRelations>(`/api/media/${value}`);
      if (generation === loadGeneration.current) { setDetails(data); setNewSeasonNumber(String(Math.max(0, ...(data.seasons ?? []).map((entry) => entry.seasonNumber)) + 1)); }
    } catch (reason) { if (generation === loadGeneration.current) setError(reason instanceof Error ? reason.message : "Could not load title."); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  };
  const begin = () => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice(""); setProgress(""); return true;
  };
  const finish = () => { lock.current = false; setBusy(false); onBusyChange(false); };
  const refresh = async () => {
    const fresh = await request<MediaWithRelations>(`/api/media/${mediaId}`);
    setDetails(fresh); await onChanged?.(); return fresh;
  };
  const createSeason = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!details || !begin()) return;
    setSeasonBusy(true); setOperation("selection");
    try {
      const created = await request<{ id: number }>("/api/seasons", post({ mediaId: details.id, seasonNumber: Number(newSeasonNumber), name: newSeasonName.trim() || null }));
      await refresh(); if (seasonForm.current) seasonForm.current.open = false; setSeasonId(String(created.id)); setNewSeasonNumber(String(Number(newSeasonNumber) + 1)); setNewSeasonName(""); setNotice("Season created. Enter the episode range below.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create season.");
      await refresh().catch(() => undefined);
    } finally { setSeasonBusy(false); finish(); }
  };
  const createRange = async () => {
    if (!season || !begin()) return;
    setOperation("range");
    try {
      const range = episodeRange(start, end);
      await request("/api/episodes/batch", post({ seasonId: season.id, ...range, titlePrefix: "Episode" }));
      await refresh(); setNotice(`Created Episodes ${start}–${end}. Add links below; no links or other qualities were changed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create range.");
      // If the response was lost, show the actual saved episodes rather than silently retrying.
      await refresh().catch(() => undefined);
    } finally { finish(); }
  };
  const deleteEpisodes = async (ids: number[] | null) => {
    if (!season || !confirm(ids ? `Move ${ids.length} selected episode(s) and their links/comments to the Recycle Bin? R2 files are retained.` : "Move ALL episodes in this season to the Recycle Bin? This is recoverable; R2 files are retained.") || !begin()) return;
    setOperation("links");
    try {
      await request("/api/episodes/batch", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seasonId: season.id, ...(ids ? { ids } : { all: true, confirmation: "MOVE ALL EPISODES" }) }) });
      setSelectedIds([]); await refresh(); setNotice("Episodes moved to the Recycle Bin. Their links, comments and R2 files were retained.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not move episodes."); await refresh().catch(() => undefined); }
    finally { finish(); }
  };
  const saveLinks = async () => {
    if (!season || !begin()) return;
    setOperation("links");
    try {
      const selected = episodes.filter((episode) => (drafts[keyFor(episode.id)] ?? "").trim() && !["saved", "exists"].includes(results[keyFor(episode.id)]?.state ?? ""));
      if (!selected.length) { setNotice("Paste at least one new link. Blank rows and saved links are skipped."); return; }
      const invalid = selected.filter((episode) => validateEpisodeLink(drafts[keyFor(episode.id)]));
      if (invalid.length) {
        for (const episode of invalid) setResults((current) => ({ ...current, [keyFor(episode.id)]: { state: "error", message: validateEpisodeLink(drafts[keyFor(episode.id)])! } }));
        setError("Fix the invalid links before saving. Nothing new was submitted."); return;
      }
      const fresh = await refresh();
      const existingSeason = fresh.seasons?.find((entry) => entry.id === season.id);
      if (!existingSeason) throw new Error("This season no longer exists.");
      let saved = 0, failed = 0, skipped = 0;
      for (const [index, episode] of selected.entries()) {
        const key = keyFor(episode.id), url = drafts[key].trim();
        setProgress(`Processing ${index + 1} of ${selected.length}`);
        setResults((current) => ({ ...current, [key]: { state: "saving", message: "Saving…" } }));
        const currentEpisode = existingSeason.episodes.find((entry) => entry.id === episode.id);
        const result: LinkResult = currentEpisode ? await saveEpisodeQualityLink(currentEpisode, quality, url, async () => {
          await request("/api/download-links", post({ mediaId: Number(mediaId), seasonId: season.id, episodeId: episode.id, quality, label: qualityDisplay(quality), url, linkBehavior }));
        }) : { state: "error", message: "Episode no longer exists. Refresh this season." };
        if (result.state === "saved") saved++; else if (result.state === "exists") skipped++; else failed++;
        setResults((current) => ({ ...current, [key]: result }));
      }
      setNotice(`${saved} saved · ${failed} failed · ${skipped} existing qualities skipped. Other qualities were not changed.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save links."); }
    finally { setProgress(""); finish(); }
  };

  const feedback = <>
    {progress && <p role="status" className="text-sm text-purple-200">{progress}</p>}
    {error && <p role="alert" className="break-words text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
  </>;
  return <section className="min-w-0 space-y-4" aria-label="Bulk episode quality links">
    <div><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">Episodes &amp; quality links</h2><button type="button" disabled={busy || !details} onClick={() => { if (begin()) { setOperation("selection"); void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not refresh season.")).finally(finish); } }} className="min-h-11 rounded-lg border border-neutral-800 px-3 text-xs text-neutral-300 disabled:opacity-40">Refresh season</button></div><p className="mt-1 text-sm text-neutral-400">Choose a title and season, generate an episode range, then paste links directly into the table. Switch quality to add another version without replacing existing links.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-xs text-neutral-400">Anime / series<select aria-label="Link batch anime or series" value={mediaId} disabled={!!initialMediaId || busy || loading} onChange={(event) => void selectTitle(event.target.value)} className={`${control} mt-1`}><option value="">Select a title</option>{titles.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="min-w-0 text-xs text-neutral-400">Season<select aria-label="Link batch season" value={seasonId} disabled={busy || loading || !details} onChange={(event) => { setSelectedIds([]); setSeasonId(event.target.value); setNotice(""); setError(""); }} className={`${control} mt-1`}><option value="">Select a season</option>{details?.seasons?.map((entry) => <option key={entry.id} value={entry.id}>Season {entry.seasonNumber}{entry.name ? ` — ${entry.name}` : ""}</option>)}</select></label>
    </div>
    {operation === "selection" && feedback}
    {loading && <p role="status" className="text-sm text-neutral-400">Loading…</p>}
    {details && <details ref={seasonForm} open={!details.seasons?.length} className="rounded-xl border border-neutral-800 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-purple-300">+ Create a season</summary><form onSubmit={createSeason} className="grid gap-2 pb-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto]"><label className="text-xs text-neutral-400">New season #<input aria-label="New season number" type="number" min={1} max={10000} required value={newSeasonNumber} disabled={busy} onChange={(event) => setNewSeasonNumber(event.target.value)} className={`${control} mt-1`} /></label><label className="min-w-0 text-xs text-neutral-400">Name (optional)<input value={newSeasonName} disabled={busy} maxLength={255} onChange={(event) => setNewSeasonName(event.target.value)} placeholder="e.g. Season 2" className={`${control} mt-1`} /></label><button type="submit" disabled={busy} className="min-h-11 self-end rounded-lg border border-purple-500/40 px-3 text-sm text-purple-200 disabled:opacity-40">{seasonBusy ? "Creating…" : "Create season"}</button></form></details>}
    <div className="space-y-3 rounded-xl border border-neutral-800 p-3">
      <h3 className="text-sm font-semibold">1. Generate your episode range</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_8rem_auto] sm:items-end">
        <label className="text-xs text-neutral-400">Start episode<input aria-label="Start episode" type="number" min={1} max={100000} value={start} disabled={busy} onChange={(event) => setStart(event.target.value)} className={`${control} mt-1`} /></label>
        <label className="text-xs text-neutral-400">End episode<input aria-label="End episode" type="number" min={1} max={100000} value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} className={`${control} mt-1`} /></label>
        <button type="button" disabled={busy || !season} onClick={() => void createRange()} className="col-span-2 min-h-10 rounded-lg border border-purple-500/40 px-3 text-sm text-purple-200 disabled:opacity-40 sm:col-span-1 sm:justify-self-start">Create Episodes</button>
      </div>
      <p className="text-xs text-neutral-400">Example: 1–24 creates 24 saved episode entries immediately. Up to 500 at once. Existing episode numbers are never overwritten; overlapping ranges are rejected safely.</p>
      {operation === "range" && feedback}
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h3 className="text-sm font-semibold">2. Add links by quality</h3><div className="flex flex-wrap items-end gap-2"><label className="text-xs text-neutral-400">Batch quality<select aria-label="Batch link quality" value={quality} disabled={busy} onChange={(event) => { setQuality(event.target.value as VideoQuality); setError(""); setNotice(""); }} className={`${control} mt-1`}>{QUALITIES.map((value) => <option key={value} value={value}>{qualityDisplay(value)}</option>)}</select></label><label className="text-xs text-neutral-400">Link behavior<select aria-label="Batch link behavior" value={linkBehavior} disabled={busy} onChange={(event) => setLinkBehavior(event.target.value as LinkBehavior)} className={`${control} mt-1`}>{LINK_BEHAVIORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div></div>
        {linkBehavior === "copy" && <p className="text-xs text-neutral-400">Links saved now copy the download link{details?.copyWebsite ? `, then open ${websiteHost(details.copyWebsite)}` : ". Save a default website under Appearance to open one after copying"}. Saved links keep their own settings.</p>}
      <p className="text-xs text-neutral-400">{episodes.length} episodes · Paste links only where needed; blank rows are skipped. Existing links for this quality are protected. Use the individual editor to replace a link.</p>
      {!!episodes.length && <div className="space-y-2 rounded-lg border border-neutral-800 p-2"><div className="flex flex-wrap items-center gap-2"><label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" aria-label="Select all episodes" checked={episodes.length > 0 && episodes.every((episode) => selectedIds.includes(episode.id))} disabled={busy} onChange={(event) => setSelectedIds(event.target.checked ? episodes.map((episode) => episode.id) : [])} />{selectedIds.length} selected</label><button type="button" disabled={busy || !selectedIds.length || selectedIds.length > 500} onClick={() => void deleteEpisodes(selectedIds)} className="min-h-10 rounded-md border border-red-900/60 px-2 text-xs text-red-300 disabled:opacity-40">Delete selected</button><button type="button" disabled={busy} onClick={() => void deleteEpisodes(null)} className="min-h-10 rounded-md px-2 text-xs text-red-300 disabled:opacity-40">Delete All Episodes</button></div><details><summary className="min-h-9 cursor-pointer py-2 text-xs text-neutral-400">Select episode range to delete</summary><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"><label className="text-xs text-neutral-400">From<input aria-label="Delete range start" type="number" min={1} value={deleteStart} onChange={(event) => setDeleteStart(event.target.value)} className={control} /></label><label className="text-xs text-neutral-400">To<input aria-label="Delete range end" type="number" min={1} value={deleteEnd} onChange={(event) => setDeleteEnd(event.target.value)} className={control} /></label><button type="button" disabled={busy} onClick={() => { try { const range = episodeRange(deleteStart, deleteEnd); setSelectedIds(episodes.filter((episode) => episode.episodeNumber >= range.start && episode.episodeNumber < range.start + range.count).map((episode) => episode.id)); } catch (reason) { setOperation("links"); setError(String(reason)); } }} className="min-h-10 rounded-md border border-neutral-700 px-2 text-xs">Select range</button></div></details></div>}
      <div className="max-h-[60vh] overflow-y-auto overscroll-contain rounded-xl border border-neutral-800" aria-label="Episode link rows">
        {!episodes.length ? <p className="p-3 text-sm text-neutral-400">Select or create a season, then enter a range above to generate episodes.</p> : <table className="w-full table-fixed text-left text-xs"><thead className="sticky top-0 z-10 bg-neutral-900 text-neutral-400"><tr><th className="w-24 px-2 py-3">Episode</th><th className="px-2 py-3">{qualityDisplay(quality)} download link</th></tr></thead><tbody>
        {episodes.map((episode) => {
          const key = keyFor(episode.id), existing = qualityLinks(episode, quality), result = results[key];
          return <tr key={episode.id} data-testid="quality-link-row" className="border-t border-neutral-800/60 align-top">
            <th className="px-2 py-3 font-medium"><input type="checkbox" className="mr-1" aria-label={`Select episode ${episode.episodeNumber}`} checked={selectedIds.includes(episode.id)} disabled={busy} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, episode.id] : current.filter((id) => id !== episode.id))} /><label htmlFor={`quality-link-${episode.id}`}>Episode {episode.episodeNumber}</label><button type="button" aria-label={`Delete episode ${episode.episodeNumber}`} disabled={busy} onClick={() => void deleteEpisodes([episode.id])} className="mt-1 block min-h-9 px-1 text-[11px] font-normal text-red-300 disabled:opacity-40">Delete</button></th>
            <td className="min-w-0 p-2"><input id={`quality-link-${episode.id}`} aria-label={`Link for episode ${episode.episodeNumber}`} type="text" value={drafts[key] ?? existing[0]?.url ?? ""} disabled={busy || existing.length > 0 || result?.state === "saved"} placeholder="Paste link" onChange={(event) => { setDrafts((current) => ({ ...current, [key]: event.target.value })); setResults((current) => { const next = { ...current }; delete next[key]; return next; }); }} className={control} />
            <p role="status" className={`break-words pt-1 text-[11px] ${result?.state === "error" ? "text-red-300" : result?.state === "saved" || existing.length ? "text-emerald-300" : "text-neutral-500"}`}>{result?.message ?? (existing.length ? "Already saved for this quality" : drafts[key]?.trim() ? "Pending · ready to save" : "Pending · no link entered")}</p>
            {!!episode.downloadLinks.length && <p className="pt-0.5 text-[10px] text-neutral-500">Saved qualities: {[...new Set(episode.downloadLinks.map((link) => link.quality || "unspecified"))].join(", ")}</p>}</td>
          </tr>;
        })}</tbody></table>}
      </div>
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-700 bg-neutral-950/95 p-2 pr-16 shadow-lg"><p aria-live="polite" className="text-xs text-neutral-400">{episodes.filter((episode) => drafts[keyFor(episode.id)]?.trim() && !qualityLinks(episode, quality).length && results[keyFor(episode.id)]?.state !== "saved").length} pending · {episodes.filter((episode) => results[keyFor(episode.id)]?.state === "error").length} failed</p><button type="button" onClick={() => void saveLinks()} disabled={busy || !episodes.length} className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-semibold disabled:opacity-40">{busy ? "Processing…" : "Save All"}</button></div>
      {operation === "links" && feedback}
    </div>

  </section>;
}
