"use client";

import { useRef, useState } from "react";
import type { Category, Media, MediaType, MediaWithRelations, VideoQuality } from "@/lib/types";
import { QUALITIES, qualityDisplay } from "@/lib/media-links";
import { validateEpisodeLink } from "@/lib/episode-quality-batch";
import MediaPosterUploader from "./MediaPosterUploader";

const control = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-purple-400 disabled:opacity-60";
const button = "min-h-11 rounded-lg border border-neutral-700 px-3 py-2 text-sm disabled:opacity-50";
type DraftLink = { id: number; quality: VideoQuality; url: string };
async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save. Please retry.");
  return data;
}

export default function MediaWizard({ categories, initialType = "movie", onCancel, onSaved, onBusyChange }: {
  categories: Category[]; initialType?: MediaType; onCancel: () => void; onSaved: (item: Media) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState<MediaType>(initialType);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [poster, setPoster] = useState("");
  const [seasonNumber, setSeasonNumber] = useState("1");
  const [seasonName, setSeasonName] = useState("");
  const [links, setLinks] = useState<DraftLink[]>([{ id: 1, quality: "1080p", url: "" }]);
  const [busy, setBusy] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const saved = useRef<Media | null>(null);
  const lock = useRef(false);
  const steps = ["Basic details", "Poster", type === "movie" ? "Download links" : "First season"];
  const cancel = () => { if (!busy && !posterBusy && (!title.trim() || confirm(saved.current ? "Leave setup? The saved title and any saved links/seasons will be retained." : "Discard this unsaved title draft?"))) onCancel(); };
  const save = async () => {
    if (lock.current || posterBusy || uncertain) return;
    const invalid = type === "movie" ? links.find((link) => validateEpisodeLink(link.url)) : null;
    if (invalid) { setError("Use HTTP(S), Telegram or magnet download links. Blank rows are skipped."); return; }
    if (type !== "movie" && (!/^\d+$/.test(seasonNumber) || Number(seasonNumber) < 1)) { setError("Enter a positive season number."); return; }
    lock.current = true; setBusy(true); onBusyChange?.(true); setError("");
    try {
      if (!saved.current) {
        setNotice("Saving title…");
        // A lost creation response is not safe to retry automatically.
        let response: Response;
        try { response = await fetch("/api/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, title: title.trim(), year: year ? Number(year) : null, categoryId: categoryId ? Number(categoryId) : null, description, posterUrl: poster }) }); }
        catch { setUncertain(true); throw new Error("Creation response was lost. Check the media library before creating this title again."); }
        if (response.status >= 500) setUncertain(true);
        if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Could not save title. Check the library before retrying."); }
        try { saved.current = await response.json() as Media; setSavedId(saved.current.id); }
        catch { setUncertain(true); throw new Error("Creation response was unreadable. Check the media library before creating this title again."); }
      }
      const item = saved.current!;
      const response = await fetch(`/api/media/${item.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Title saved. Could not check its links/seasons; retry to continue without recreating it.");
      const details: MediaWithRelations = await response.json();
      if (type === "movie") {
        const existing = new Set((details.downloadLinks ?? []).map((link) => `${link.quality}:${link.url}`));
        const filled = links.filter((link) => link.url.trim());
        for (const [index, link] of filled.entries()) {
          const url = link.url.trim(), key = `${link.quality}:${url}`;
          setNotice(`Title saved · saving download ${index + 1} of ${filled.length}`);
          if (!existing.has(key)) { await post("/api/download-links", { mediaId: item.id, quality: link.quality, label: qualityDisplay(link.quality), url }); existing.add(key); }
        }
      } else if (!(details.seasons ?? []).some((season) => season.seasonNumber === Number(seasonNumber))) {
        setNotice("Title saved · creating first season…");
        await post("/api/seasons", { mediaId: item.id, seasonNumber: Number(seasonNumber), name: seasonName.trim() || null });
      }
      onSaved(item);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed."); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  };
  return <form aria-label="New media setup" onSubmit={(event) => { event.preventDefault(); setError(""); if (!title.trim()) { setStep(0); setError("Title is required."); return; } if (step < 2) setStep(step + 1); else void save(); }} className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-xl font-bold">Add New Media</h2><p className="mt-1 text-sm text-neutral-400">Three short steps. The title is created on Save; uploaded poster files are stored immediately.</p></div><button type="button" disabled={busy || posterBusy} onClick={cancel} className={button}>← Back</button></div>
    <ol aria-label="Setup progress" className="grid grid-cols-3 gap-2">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`rounded-lg border px-2 py-2 text-xs ${step === index ? "border-purple-500 bg-purple-500/10 text-purple-200" : "border-neutral-800 text-neutral-500"}`}>{index + 1}. {label}</li>)}</ol>
    <fieldset disabled={busy || !!savedId} hidden={step !== 0} className="min-w-0 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-400">Type<select aria-label="Type" value={type} onChange={(event) => setType(event.target.value as MediaType)} className={control}><option value="movie">Movie</option><option value="anime">Anime</option><option value="series">TV Series</option></select></label><label className="text-xs text-neutral-400">Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} required={step === 0} placeholder="e.g. Your next release" className={control} /></label><label className="text-xs text-neutral-400">Year<input type="number" value={year} onChange={(event) => setYear(event.target.value)} placeholder="e.g. 2026" className={control} /></label><label className="text-xs text-neutral-400">Category<select aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={control}><option value="">None</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-purple-300">Optional description</summary><label className="block text-xs text-neutral-400">Description<textarea rows={3} maxLength={20000} value={description} onChange={(event) => setDescription(event.target.value)} className={control} /></label></details>
    </fieldset>
    <fieldset disabled={busy || !!savedId} hidden={step !== 1} className="min-w-0 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4"><h3 className="font-medium">Poster image</h3><p className="text-xs text-neutral-400">Upload privately to R2, paste an image URL, or continue without a poster.</p><div className="flex flex-col gap-3 sm:flex-row"><MediaPosterUploader currentUrl={poster} onUpload={setPoster} onBusyChange={(value) => { setPosterBusy(value); onBusyChange?.(value); }} /><label className="min-w-0 flex-1 text-xs text-neutral-400">Poster URL<input value={poster} onChange={(event) => setPoster(event.target.value)} placeholder="https://…" className={control} /></label></div></fieldset>
    <fieldset disabled={busy} hidden={step !== 2} className="min-w-0 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
      <h3 className="font-medium">{type === "movie" ? "Downloads by quality" : "Create your first season"}</h3>
      {type === "movie" ? <><p className="text-xs text-neutral-400">Paste each download link and choose its quality. Private video uploads and all advanced link options remain available in the editor after saving.</p>{links.map((link, index) => <div key={link.id} className="grid min-w-0 gap-2 rounded-lg border border-neutral-800 p-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"><label className="text-xs text-neutral-400">Quality {index + 1}<select aria-label={`Quality ${index + 1}`} value={link.quality} onChange={(event) => setLinks((rows) => rows.map((row) => row.id === link.id ? { ...row, quality: event.target.value as VideoQuality } : row))} className={control}>{QUALITIES.map((quality) => <option key={quality} value={quality}>{qualityDisplay(quality)}</option>)}</select></label><label className="min-w-0 text-xs text-neutral-400">Download link {index + 1}<input value={link.url} onChange={(event) => setLinks((rows) => rows.map((row) => row.id === link.id ? { ...row, url: event.target.value } : row))} placeholder="https://… or Telegram / magnet" className={control} /></label><button type="button" onClick={() => setLinks((rows) => rows.filter((row) => row.id !== link.id))} aria-label={`Remove download ${index + 1}`} className={`${button} self-end`}>Remove</button></div>)}<button type="button" onClick={() => setLinks((rows) => [...rows, { id: Math.max(0, ...rows.map((row) => row.id)) + 1, quality: "720p", url: "" }])} className={button}>+ Another quality / link</button></> : <><p className="text-xs text-neutral-400">Next, generate an episode range and paste quality-specific links in one workspace.</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-400">First season #<input type="number" min={1} value={seasonNumber} onChange={(event) => setSeasonNumber(event.target.value)} className={control} /></label><label className="text-xs text-neutral-400">Season name (optional)<input value={seasonName} maxLength={255} onChange={(event) => setSeasonName(event.target.value)} className={control} /></label></div></>}
    </fieldset>
    {savedId && <p role="status" className="text-sm text-amber-200">Title #{savedId} is already saved. Retry continues its setup without recreating the title.</p>}
    {notice && <p role="status" className="text-sm text-neutral-300">{notice}</p>}{error && <p role="alert" className="break-words text-sm text-red-300">{error}</p>}
    <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-700 bg-neutral-950/95 p-2 pr-16 shadow-lg"><button type="button" disabled={busy || posterBusy} onClick={cancel} className={button}>Cancel</button><div className="flex gap-2">{step > 0 && <button type="button" disabled={busy || posterBusy || !!savedId} onClick={() => setStep(step - 1)} className={button}>Previous</button>}<button type="submit" disabled={busy || posterBusy || uncertain} className={`${button} border-purple-500/50 bg-violet-600 font-semibold text-white`}>{busy ? "Saving…" : step < 2 ? "Next" : savedId ? "Retry setup" : type === "movie" ? "Save movie" : "Create & Continue"}</button></div></div>
  </form>;
}
