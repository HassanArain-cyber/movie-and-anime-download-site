"use client";

import { useEffect, useRef, useState } from "react";
import { QUALITIES, qualityDisplay } from "@/lib/media-links";
import { episodeRange, qualityLinks, saveEpisodeQualityLink, validateEpisodeLink, type LinkResult } from "@/lib/episode-quality-batch";
import type { Media, MediaWithRelations, VideoQuality } from "@/lib/types";

const control = "min-h-10 w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white disabled:opacity-50";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function BulkEpisodeLinks({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [titles, setTitles] = useState<Media[]>([]);
  const [mediaId, setMediaId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [details, setDetails] = useState<MediaWithRelations | null>(null);
  const [quality, setQuality] = useState<VideoQuality>("720p");
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
  const lock = useRef(false);
  const loadGeneration = useRef(0);
  const season = details?.seasons?.find((entry) => entry.id === Number(seasonId));
  const episodes = [...(season?.episodes ?? [])].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const keyFor = (id: number) => `${id}:${quality}`;

  useEffect(() => {
    const controller = new AbortController();
    request<Media[]>("/api/media", { signal: controller.signal }).then((items) => setTitles(items.filter((item) => item.type !== "movie")))
      .catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const selectTitle = async (value: string) => {
    const generation = ++loadGeneration.current;
    setOperation("selection"); setMediaId(value); setDetails(null); setSeasonId(""); setError(""); setNotice(""); setProgress("");
    if (!value) return;
    setLoading(true);
    try {
      const data = await request<MediaWithRelations>(`/api/media/${value}`);
      if (generation === loadGeneration.current) setDetails(data);
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
    setDetails(fresh); return fresh;
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
          await request("/api/download-links", post({ mediaId: Number(mediaId), seasonId: season.id, episodeId: episode.id, quality, label: qualityDisplay(quality), url }));
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
    <div><h2 className="text-xl font-bold">Episodes &amp; quality links</h2><p className="mt-1 text-sm text-neutral-400">Create placeholders once, then add a batch of links for each quality.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-xs text-neutral-400">Anime / series<select aria-label="Link batch anime or series" value={mediaId} disabled={busy || loading} onChange={(event) => void selectTitle(event.target.value)} className={`${control} mt-1`}><option value="">Select a title</option>{titles.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="min-w-0 text-xs text-neutral-400">Season<select aria-label="Link batch season" value={seasonId} disabled={busy || loading || !details} onChange={(event) => { setSeasonId(event.target.value); setNotice(""); setError(""); }} className={`${control} mt-1`}><option value="">Select a season</option>{details?.seasons?.map((entry) => <option key={entry.id} value={entry.id}>Season {entry.seasonNumber}{entry.name ? ` — ${entry.name}` : ""}</option>)}</select></label>
    </div>
    {operation === "selection" && feedback}
    {loading && <p role="status" className="text-sm text-neutral-400">Loading…</p>}
    {details && !details.seasons?.length && <p className="text-sm text-amber-300">Create a season in Media first.</p>}
    <div className="space-y-3 rounded-xl border border-neutral-800 p-3">
      <h3 className="text-sm font-semibold">1. Create Episodes</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_8rem_auto] sm:items-end">
        <label className="text-xs text-neutral-400">Start episode<input aria-label="Start episode" type="number" min={1} max={100000} value={start} disabled={busy} onChange={(event) => setStart(event.target.value)} className={`${control} mt-1`} /></label>
        <label className="text-xs text-neutral-400">End episode<input aria-label="End episode" type="number" min={1} max={100000} value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} className={`${control} mt-1`} /></label>
        <button type="button" disabled={busy || !season} onClick={() => void createRange()} className="col-span-2 min-h-10 rounded-lg border border-purple-500/40 px-3 text-sm text-purple-200 disabled:opacity-40 sm:col-span-1 sm:justify-self-start">Create Episodes</button>
      </div>
      <p className="text-xs text-neutral-400">Inclusive range, up to 500 episodes at once. Existing episode numbers are never overwritten.</p>
      {operation === "range" && feedback}
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h3 className="text-sm font-semibold">2. Bulk Add Links by Quality</h3><label className="text-xs text-neutral-400">Batch quality<select aria-label="Batch link quality" value={quality} disabled={busy} onChange={(event) => { setQuality(event.target.value as VideoQuality); setError(""); setNotice(""); }} className={`${control} mt-1`}>{QUALITIES.map((value) => <option key={value} value={value}>{qualityDisplay(value)}</option>)}</select></label></div>
      <p className="text-xs text-neutral-400">{episodes.length} episodes · Paste links only where needed; blank rows are skipped. Existing links for this quality are protected. Use the individual editor to replace a link.</p>
      <div className="max-h-[60vh] space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-neutral-800 p-2" aria-label="Episode link rows">
        {!episodes.length && <p className="p-3 text-sm text-neutral-400">Select a season and create episodes first.</p>}
        {episodes.map((episode) => {
          const key = keyFor(episode.id), existing = qualityLinks(episode, quality), result = results[key];
          return <div key={episode.id} data-testid="quality-link-row" className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 border-b border-neutral-800/60 py-1 last:border-0">
            <label htmlFor={`quality-link-${episode.id}`} className="text-xs font-medium">Episode {episode.episodeNumber}</label>
            <input id={`quality-link-${episode.id}`} aria-label={`Link for episode ${episode.episodeNumber}`} type="text" value={drafts[key] ?? existing[0]?.url ?? ""} disabled={busy || existing.length > 0 || result?.state === "saved"} placeholder="Paste link" onChange={(event) => { setDrafts((current) => ({ ...current, [key]: event.target.value })); setResults((current) => { const next = { ...current }; delete next[key]; return next; }); }} className={control} />
            {(result || existing.length > 0) && <p role="status" className={`col-start-2 break-words py-1 text-[11px] ${result?.state === "error" ? "text-red-300" : "text-neutral-400"}`}>{result?.message ?? "Already saved for this quality"}</p>}
          </div>;
        })}
      </div>
      <button type="button" onClick={() => void saveLinks()} disabled={busy || !episodes.length} className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-semibold disabled:opacity-40">{busy ? "Processing…" : "Save quality links"}</button>
      {operation === "links" && feedback}
    </div>

  </section>;
}
