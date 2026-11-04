"use client";

import { useEffect, useRef, useState } from "react";
import type { Media, MediaWithRelations, SeasonWithEpisodes, VideoQuality } from "@/lib/types";
import { BulkApiError, guessEpisodeNumber, processBulkEpisode, validateBulkEpisodes, type BulkEpisodeRow } from "@/lib/bulk-episodes";
import { QUALITIES } from "@/lib/media-links";
import { uploadToR2, UploadError } from "@/lib/upload-client";

const control = "min-h-10 w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white";
const newRow = (number = ""): BulkEpisodeRow => ({ id: crypto.randomUUID(), number, title: "", duration: "", url: "", quality: "1080p", status: "pending", progress: 0 });
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new BulkApiError(data.error || `Request failed (${response.status})`);
  return data as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function BulkAddEpisodes({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [items, setItems] = useState<Media[]>([]);
  const [mediaId, setMediaId] = useState("");
  const [details, setDetails] = useState<MediaWithRelations | null>(null);
  const [seasonId, setSeasonId] = useState("");
  const [rows, setRows] = useState<BulkEpisodeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const season = details?.seasons?.find((entry) => entry.id === Number(seasonId));
  const targetLocked = busy || rows.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    json<Media[]>("/api/media", { signal: controller.signal }).then((data) => setItems(data.filter((item) => item.type !== "movie")))
      .catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    json<{ configured: boolean }>("/api/storage/status", { signal: controller.signal }).then((data) => setStorageReady(data.configured)).catch(() => undefined);
    return () => { controller.abort(); abort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const chooseMedia = async (value: string) => {
    setMediaId(value); setDetails(null); setSeasonId(""); setError("");
    if (!value) return;
    setLoading(true);
    try { setDetails(await json<MediaWithRelations>(`/api/media/${value}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load seasons."); }
    finally { setLoading(false); }
  };
  const update = (id: string, patch: Partial<BulkEpisodeRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const addRow = () => setRows((current) => [...current, newRow(String(Math.max(0, ...(season?.episodes ?? []).map((ep) => ep.episodeNumber), ...current.map((row) => Number(row.number) || 0)) + 1))]);

  const submit = async () => {
    if (lock.current || !season || rows.every((row) => row.status === "done")) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(""); setNotice("");
    const controller = new AbortController(); abort.current = controller;
    try {
      const fresh = await json<MediaWithRelations>(`/api/media/${mediaId}`, { signal: controller.signal });
      setDetails(fresh);
      const selected = fresh.seasons?.find((entry) => entry.id === Number(seasonId));
      if (!selected) throw new Error("This season no longer exists. Review your selection.");
      const errors = validateBulkEpisodes(rows, selected.episodes);
      if (Object.keys(errors).length) {
        setRows((current) => current.map((row) => errors[row.id] ? { ...row, status: "error", error: errors[row.id] } : row));
        setError("Review the highlighted rows. Nothing new was submitted."); return;
      }
      if (rows.some((row) => row.file && row.status !== "done") && !storageReady) throw new Error("R2 is not configured. External download links still work.");
      for (const row of rows.filter((entry) => entry.status !== "done")) {
        if (controller.signal.aborted) break;
        await processBulkEpisode(row, {
          create: (entry) => json<{ id: number }>("/api/episodes", { ...post({ mediaId: Number(mediaId), seasonId: selected.id, episodeNumber: Number(entry.number), title: entry.title.trim(), duration: entry.duration.trim() || null }), signal: controller.signal }),
          upload: async (entry, checkpoint) => {
            try {
              return await uploadToR2(entry.file!, { kind: "video", mediaId: Number(mediaId), seasonId: selected.id, episodeId: entry.episodeId, quality: entry.quality, resumeId: entry.uploadId, signal: controller.signal,
                onSession: (uploadId) => checkpoint({ uploadId }), onProgress: (progress) => checkpoint({ progress }) });
            } catch (reason) { if (reason instanceof UploadError) checkpoint({ uploadId: reason.uploadId }); throw reason; }
          },
          links: async (episodeId) => {
            const freshDetails = await json<MediaWithRelations>(`/api/media/${mediaId}`, { signal: controller.signal });
            const episode = freshDetails.seasons?.flatMap((entry) => entry.episodes).find((entry) => entry.id === episodeId);
            if (!episode) throw new Error("Created episode could not be found. Review it in Media.");
            return episode.downloadLinks;
          },
          attach: async (entry) => { await json("/api/download-links", { ...post({ mediaId: Number(mediaId), seasonId: selected.id, episodeId: entry.episodeId, quality: entry.quality, label: entry.quality,
            ...(entry.completed ? { r2UploadId: entry.completed.id } : { url: entry.url.trim() }) }), signal: controller.signal }); },
        }, (checkpoint) => update(row.id, checkpoint));
      }
      setNotice("Batch finished. Successful rows are saved; retry only failed rows below. Keep this page open to preserve retry checkpoints.");
      setDetails(await json<MediaWithRelations>(`/api/media/${mediaId}`, { signal: controller.signal }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Batch failed."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };

  const addFiles = (selected: FileList) => {
    const added = Array.from(selected).map((file) => ({ ...newRow(guessEpisodeNumber(file.name)), title: file.name.replace(/\.[^.]+$/, "").slice(0, 255), file }));
    setRows((current) => [...current, ...added]);
  };
  const completed = rows.filter((row) => row.status === "done").length;
  return <section className="min-w-0 space-y-4" aria-label="Bulk Add Episodes">
    <div><h2 className="text-xl font-bold text-white">Bulk Add Episodes</h2><p className="mt-1 text-sm text-neutral-400">Choose an anime or series and season. Enter links or match multiple video files to new episode rows.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-xs text-neutral-400">Anime / series<select aria-label="Bulk anime or series" value={mediaId} disabled={targetLocked || loading} onChange={(event) => void chooseMedia(event.target.value)} className={`${control} mt-1`}><option value="">Select a title</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="min-w-0 text-xs text-neutral-400">Season<select aria-label="Bulk season" value={seasonId} disabled={targetLocked || loading || !details} onChange={(event) => setSeasonId(event.target.value)} className={`${control} mt-1`}><option value="">Select a season</option>{details?.seasons?.map((entry: SeasonWithEpisodes) => <option key={entry.id} value={entry.id}>Season {entry.seasonNumber}{entry.name ? ` — ${entry.name}` : ""}</option>)}</select></label>
    </div>
    {loading && <p role="status" className="text-sm text-neutral-400">Loading titles / seasons…</p>}
    {details && !details.seasons?.length && <p className="text-sm text-amber-300">Create a season in Media first, then return here.</p>}
    <p className="text-xs leading-relaxed text-neutral-400">Files go directly to R2 using the existing secure multipart upload. Numbers are guessed from names such as S01E03.mp4; check them before submitting. Leave either the link or file empty. Duration is optional. Do not close this page during processing.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!season || busy} onClick={addRow} className="min-h-11 rounded-lg border border-neutral-700 px-3 text-sm disabled:opacity-40">Add Another Episode</button>
      <button type="button" disabled={!season || busy || !storageReady} onClick={() => files.current?.click()} className="min-h-11 rounded-lg border border-neutral-700 px-3 text-sm disabled:opacity-40">Select multiple video files</button>
      <input ref={files} aria-label="Bulk video files" type="file" multiple hidden accept=".mp4,.webm,.mkv,.mov,.avi,.m4v" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
      {rows.length > 0 && <button type="button" disabled={busy} onClick={() => { if (confirm("Clear this batch and its retry checkpoints? Saved episodes and files will NOT be deleted.")) { setRows([]); setError(""); setNotice(""); } }} className="min-h-11 px-3 text-sm text-neutral-400">Start a new batch</button>}
    </div>
    {!storageReady && <p className="text-xs text-neutral-400">File uploads are unavailable until R2 is configured. You can still add download links.</p>}
    <div className="space-y-3">{rows.map((row, index) => <fieldset key={row.id} data-testid="bulk-episode-row" disabled={busy || row.status === "done"} className="min-w-0 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
      <legend className="px-1 text-sm font-semibold">Entry {index + 1}</legend>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
        <label className="text-xs text-neutral-400">Episode #<input aria-label="Episode number" type="number" min="1" max="100000" value={row.number} disabled={!!row.episodeId || row.uncertainCreation} onChange={(event) => update(row.id, { number: event.target.value })} className={`${control} mt-1`} /></label>
        <label className="min-w-0 text-xs text-neutral-400">Title<input aria-label="Episode title" value={row.title} maxLength={255} disabled={!!row.episodeId} onChange={(event) => update(row.id, { title: event.target.value })} className={`${control} mt-1`} /></label>
      </div>
      <label className="block text-xs text-neutral-400">Video / download link<input aria-label="Episode download link" value={row.url} disabled={!!row.file} placeholder="https://… or Telegram / magnet link" onChange={(event) => update(row.id, { url: event.target.value })} className={`${control} mt-1`} /></label>
      <label className="block min-w-0 text-xs text-neutral-400">Or video file<input aria-label="Episode video file" type="file" accept=".mp4,.webm,.mkv,.mov,.avi,.m4v" disabled={!storageReady || !!row.uploadId || !!row.completed} onChange={(event) => update(row.id, { file: event.target.files?.[0], url: "" })} className="mt-1 block w-full min-w-0 text-xs file:mr-2 file:rounded file:border-0 file:bg-neutral-800 file:p-2 file:text-white" /></label>
      {row.file && <div className="flex min-w-0 items-center gap-2 text-xs"><span className="min-w-0 flex-1 break-all">{row.file.name}</span>{!row.uploadId && <button type="button" onClick={() => update(row.id, { file: undefined })} className="min-h-9 shrink-0 px-2 text-purple-300">Clear file</button>}</div>}
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-neutral-400">Quality<select aria-label="Episode quality" value={row.quality} disabled={!!row.uploadId} onChange={(event) => update(row.id, { quality: event.target.value as VideoQuality })} className={`${control} mt-1`}>{QUALITIES.map((quality) => <option key={quality}>{quality}</option>)}</select></label><label className="text-xs text-neutral-400">Duration (optional)<input aria-label="Episode duration" value={row.duration} maxLength={20} disabled={!!row.episodeId} placeholder="24m" onChange={(event) => update(row.id, { duration: event.target.value })} className={`${control} mt-1`} /></label></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><span role="status" className={`text-xs ${row.status === "done" ? "text-emerald-300" : row.status === "error" ? "text-red-300" : "text-neutral-300"}`}>{row.status === "done" ? "Saved" : row.status === "uploading" ? `Uploading ${row.progress}%` : row.status}{row.episodeId && row.status !== "done" ? " · episode saved; link pending" : ""}</span>{!row.episodeId && !row.uncertainCreation && <button type="button" aria-label={`Remove entry ${index + 1}`} onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="min-h-9 px-2 text-xs text-neutral-400">Remove row</button>}</div>
      {row.status === "uploading" && <progress className="h-2 w-full accent-purple-500" value={row.progress} max={100} aria-label={`Entry ${index + 1} upload progress`} />}
      {row.error && <p role="alert" className="break-words text-xs text-red-300">{row.error}{row.uncertainCreation ? " Check Media before retrying this number." : ""}</p>}
    </fieldset>)}</div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy || rows.length === 0 || completed === rows.length} onClick={() => void submit()} className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-semibold disabled:opacity-40">{busy ? "Processing episodes…" : rows.some((row) => row.status === "error") ? "Retry failed episodes" : "Save all episodes"}</button><span aria-live="polite" className="text-xs text-neutral-400">{completed} / {rows.length} saved · {rows.filter((row) => row.status === "error").length} failed</span></div>
  </section>;
}
