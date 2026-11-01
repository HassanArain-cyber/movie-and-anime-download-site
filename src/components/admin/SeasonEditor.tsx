"use client";

import { useState } from "react";
import type { SeasonWithEpisodes, EpisodeWithLinks } from "@/lib/types";
import DownloadLinksEditor from "./DownloadLinksEditor";
import BatchEpisodeUploader from "./BatchEpisodeUploader";

interface Props { mediaId: number; seasons: SeasonWithEpisodes[]; onChange: () => void | Promise<void>; }
const inputClass = "rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700";

export default function SeasonEditor({ mediaId, seasons, onChange }: Props) {
  const [seasonNumber, setSeasonNumber] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const addSeason = async (event: React.FormEvent) => {
    event.preventDefault(); setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/seasons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaId, seasonNumber: Number(seasonNumber), name: seasonName.trim() || null }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSeasonNumber(""); setSeasonName(""); setExpandedSeason(data.id); await onChange();
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed"); }
    finally { setBusy(false); }
  };

  const deleteSeason = async (id: number) => {
    if (!confirm("Delete this season and all its episodes/links? R2 files are retained.")) return;
    const res = await fetch(`/api/seasons/${id}`, { method: "DELETE" });
    if (!res.ok) { const data = await res.json(); setErr(data.error || "Delete failed"); return; }
    await onChange();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Seasons</h3>
      <div className="space-y-2">
        {seasons.length === 0 && <p className="rounded-md bg-neutral-900 p-3 text-sm text-neutral-500 ring-1 ring-neutral-800">No seasons yet. Add one below.</p>}
        {seasons.map((season) => (
          <div key={season.id} className="overflow-hidden rounded-md bg-neutral-900 ring-1 ring-neutral-800">
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => setExpandedSeason(expandedSeason === season.id ? null : season.id)} className="flex flex-1 flex-wrap items-center gap-2 text-left">
                <span className={`text-neutral-400 transition ${expandedSeason === season.id ? "rotate-90" : ""}`}>›</span>
                <span className="font-medium text-white">Season {season.seasonNumber}</span>
                {season.name && <span className="text-sm text-neutral-400">— {season.name}</span>}
                <span className="ml-2 text-xs text-neutral-500">({season.episodes?.length || 0} episodes · {season.downloadLinks?.length || 0} season links)</span>
              </button>
              <button type="button" onClick={() => void deleteSeason(season.id)} className="rounded border border-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/20">Delete</button>
            </div>
            {expandedSeason === season.id && (
              <div className="space-y-5 border-t border-neutral-800 bg-neutral-950 p-3">
                <DownloadLinksEditor mediaId={mediaId} seasonId={season.id} links={season.downloadLinks || []} onChange={onChange} kind="archive" />
                <BatchEpisodeUploader mediaId={mediaId} seasonId={season.id} episodes={season.episodes || []} onChange={onChange} />
                <EpisodeEditor mediaId={mediaId} seasonId={season.id} episodes={season.episodes || []} onChange={onChange} />
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={addSeason} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <label className="min-w-[120px] flex-1 text-xs font-medium text-neutral-400">Season #
          <input type="number" min={1} value={seasonNumber} onChange={(event) => setSeasonNumber(event.target.value)} placeholder="1" required className={`${inputClass} mt-1 w-full`} />
        </label>
        <label className="min-w-[200px] flex-[2] text-xs font-medium text-neutral-400">Name (optional)
          <input type="text" value={seasonName} onChange={(event) => setSeasonName(event.target.value)} placeholder="e.g. The Beginning" className={`${inputClass} mt-1 w-full`} />
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">+ Add season</button>
        {err && <p role="alert" className="w-full text-sm text-red-400">{err}</p>}
      </form>
    </div>
  );
}

function EpisodeEditor({ mediaId, seasonId, episodes, onChange }: { mediaId: number; seasonId: number; episodes: EpisodeWithLinks[]; onChange: () => void | Promise<void> }) {
  const [epNumber, setEpNumber] = useState("");
  const [epTitle, setEpTitle] = useState("");
  const [epDuration, setEpDuration] = useState("");
  const [expandedEp, setExpandedEp] = useState<number | null>(null);
  const [batchStart, setBatchStart] = useState("1");
  const [batchCount, setBatchCount] = useState("12");
  const [batchPrefix, setBatchPrefix] = useState("Episode");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const addEpisode = async (event: React.FormEvent) => {
    event.preventDefault(); setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/episodes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaId, seasonId, episodeNumber: Number(epNumber), title: epTitle.trim() || null, duration: epDuration.trim() || null }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setEpNumber(""); setEpTitle(""); setEpDuration(""); setExpandedEp(data.id); await onChange();
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed"); }
    finally { setBusy(false); }
  };

  const addBatch = async (event: React.FormEvent) => {
    event.preventDefault(); setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/episodes/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seasonId, start: Number(batchStart), count: Number(batchCount), titlePrefix: batchPrefix, duration: epDuration.trim() || null }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await onChange();
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed"); }
    finally { setBusy(false); }
  };

  const deleteEpisode = async (id: number) => {
    if (!confirm("Delete this episode and its links? R2 files are retained.")) return;
    const res = await fetch(`/api/episodes/${id}`, { method: "DELETE" });
    if (!res.ok) { const data = await res.json(); setErr(data.error || "Delete failed"); return; }
    await onChange();
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-white">Episodes</h4>
      {episodes.length === 0 && <p className="text-sm text-neutral-500">No episodes yet.</p>}
      <div className="space-y-2">
        {episodes.map((ep) => (
          <div key={ep.id} className="overflow-hidden rounded-md bg-neutral-900 ring-1 ring-neutral-800">
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => setExpandedEp(expandedEp === ep.id ? null : ep.id)} className="flex flex-1 flex-wrap items-center gap-2 text-left">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 text-xs font-semibold text-neutral-300">{ep.episodeNumber}</span>
                <span className="text-sm text-white">{ep.title || `Episode ${ep.episodeNumber}`}</span>
                {ep.duration && <span className="text-xs text-neutral-500">{ep.duration}</span>}
                <span className="ml-auto text-xs text-neutral-500">{ep.downloadLinks?.length || 0} links</span>
              </button>
              <button type="button" onClick={() => void deleteEpisode(ep.id)} className="rounded border border-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/20">Delete</button>
            </div>
            {expandedEp === ep.id && <div className="border-t border-neutral-800 bg-neutral-950 p-3">
              <DownloadLinksEditor mediaId={mediaId} seasonId={seasonId} episodeId={ep.id} links={ep.downloadLinks || []} onChange={onChange} />
            </div>}
          </div>
        ))}
      </div>

      <form onSubmit={addBatch} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
        <span className="w-full text-xs font-semibold uppercase text-neutral-500">Create a complete season</span>
        <label className="w-20 text-xs text-neutral-400">Start #<input type="number" min={1} value={batchStart} onChange={(event) => setBatchStart(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label>
        <label className="w-24 text-xs text-neutral-400">Count<input type="number" min={1} max={500} value={batchCount} onChange={(event) => setBatchCount(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label>
        <label className="min-w-[140px] flex-1 text-xs text-neutral-400">Title prefix<input type="text" value={batchPrefix} onChange={(event) => setBatchPrefix(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label>
        <button type="submit" disabled={busy} className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Create episodes</button>
      </form>

      <form onSubmit={addEpisode} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
        <span className="w-full text-xs font-semibold uppercase text-neutral-500">Add one episode</span>
        <label className="w-20 text-xs text-neutral-400">#<input type="number" min={1} value={epNumber} onChange={(event) => setEpNumber(event.target.value)} required className={`${inputClass} mt-1 w-full`} /></label>
        <label className="min-w-[140px] flex-1 text-xs text-neutral-400">Title<input type="text" value={epTitle} onChange={(event) => setEpTitle(event.target.value)} className={`${inputClass} mt-1 w-full`} /></label>
        <label className="w-24 text-xs text-neutral-400">Duration<input type="text" value={epDuration} onChange={(event) => setEpDuration(event.target.value)} placeholder="24m" className={`${inputClass} mt-1 w-full`} /></label>
        <button type="submit" disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">+ Ep</button>
        {err && <p role="alert" className="w-full text-xs text-red-400">{err}</p>}
      </form>
    </div>
  );
}
