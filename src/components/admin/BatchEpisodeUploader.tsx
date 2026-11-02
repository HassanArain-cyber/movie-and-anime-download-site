"use client";

import { useEffect, useRef, useState } from "react";
import type { CompletedUpload, EpisodeWithLinks, VideoQuality } from "@/lib/types";
import { QUALITIES, qualityDisplay } from "@/lib/media-links";
import { uploadToR2 } from "@/lib/upload-client";

type Row = {
  id: string;
  file: File;
  episodeNumber: string;
  quality: VideoQuality;
  status: "pending" | "uploading" | "attaching" | "done" | "error";
  progress: number;
  error?: string;
  uploadId?: string;
  completed?: CompletedUpload;
};

function guessEpisode(name: string): string {
  const match = /(?:S\d{1,2}E|E|EP[ ._-]?)(\d{1,4})/i.exec(name) || /(?:^|[ ._-])(\d{1,4})(?:[ ._-]|$)/.exec(name.replace(/\.[^.]+$/, ""));
  return match ? String(Number(match[1])) : "";
}

export default function BatchEpisodeUploader({ mediaId, seasonId, episodes, onChange }: { mediaId: number; seasonId: number; episodes: EpisodeWithLinks[]; onChange: () => void | Promise<void> }) {
  const [quality, setQuality] = useState<VideoQuality>("1080p");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const addFiles = (files: FileList) => {
    const next = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, episodeNumber: guessEpisode(file.name), quality, status: "pending" as const, progress: 0 }));
    setRows((current) => [...current, ...next]); setMessage("");
  };
  const update = (id: string, patch: Partial<Row>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));

  const run = async () => {
    setMessage("");
    const pendingRows = rows.filter((row) => row.status !== "done");
    const numbers = pendingRows.map((row) => Number(row.episodeNumber));
    if (numbers.some((number) => !Number.isInteger(number) || number < 1)) { setMessage("Assign a valid episode number to every file."); return; }
    const episodeQualities = pendingRows.map((row) => `${Number(row.episodeNumber)}:${row.quality}`);
    if (new Set(episodeQualities).size !== episodeQualities.length) { setMessage("Each episode can have one file per quality in a batch. Remove duplicate episode and quality pairs."); return; }
    if (numbers.some((number) => !episodes.some((episode) => episode.episodeNumber === number))) { setMessage("Create the matching episode rows first, then upload the batch."); return; }
    const controller = new AbortController(); abortRef.current = controller; setBusy(true);
    let done = 0;
    for (const row of rows.filter((item) => item.status !== "done")) {
      if (controller.signal.aborted) break;
      const episode = episodes.find((item) => item.episodeNumber === Number(row.episodeNumber))!;
      try {
        let completed = row.completed;
        if (!completed) {
          update(row.id, { status: "uploading", error: undefined });
          completed = await uploadToR2(row.file, {
            kind: "video", mediaId, seasonId, episodeId: episode.id, quality: row.quality, signal: controller.signal,
            resumeId: row.uploadId,
            onProgress: (progress) => update(row.id, { progress }), onSession: (uploadId) => update(row.id, { uploadId }),
          });
          update(row.id, { completed, progress: 100 });
        }
        update(row.id, { status: "attaching" });
        const res = await fetch("/api/download-links", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ mediaId, seasonId, episodeId: episode.id, quality: row.quality, label: row.quality, r2UploadId: completed.id }),
        });
        if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Failed to attach link"); }
        update(row.id, { status: "done", progress: 100 }); done += 1;
      } catch (error) {
        if (controller.signal.aborted) { update(row.id, { status: "error", error: "Cancelled" }); break; }
        update(row.id, { status: "error", error: error instanceof Error ? error.message : "Failed" });
      }
    }
    setBusy(false); await onChange();
    setMessage(`${done} file${done === 1 ? "" : "s"} uploaded and attached. Failed rows can be retried without re-uploading completed files.`);
  };

  return (
    <div className="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">Batch upload episode files</h4>
        <label className="flex items-center gap-2 text-xs text-neutral-500">Default quality for new files
        <select value={quality} onChange={(event) => setQuality(event.target.value as VideoQuality)} disabled={busy} className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-white">
          {QUALITIES.map((value) => <option key={value} value={value}>{qualityDisplay(value)}</option>)}
        </select></label>
      </div>
      <p className="text-xs text-neutral-500">Choose multiple files. Episode numbers are guessed from names like S01E03 or 03.mp4; correct the episode and quality on each row. The same episode can be uploaded at multiple qualities in one batch.</p>
      <input ref={fileRef} type="file" multiple accept=".mp4,.webm,.mkv,.mov,.avi,.m4v" hidden onChange={(event) => { if (event.target.files?.length) addFiles(event.target.files); event.target.value = ""; }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200">Choose files</button>
        <button type="button" onClick={() => void run()} disabled={busy || rows.length === 0 || rows.every((row) => row.status === "done")} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Uploading…" : "Upload / retry batch"}</button>
        {busy && <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300">Cancel</button>}
        {rows.length > 0 && !busy && <button type="button" onClick={() => setRows([])} className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400">Clear list</button>}
      </div>
      {rows.length > 0 && <div className="space-y-2">
        {rows.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded bg-neutral-950 p-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-neutral-300" title={row.file.name}>{row.file.name}</span>
          <label className="flex items-center gap-1 text-neutral-500">Ep
            <input type="number" min={1} value={row.episodeNumber} disabled={busy || row.status === "done" || !!row.uploadId || !!row.completed} onChange={(event) => update(row.id, { episodeNumber: event.target.value })} className="w-16 rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-white" />
          </label>
          <label className="flex items-center gap-1 text-neutral-500">Quality
            <select value={row.quality} disabled={busy || row.status === "done" || !!row.uploadId || !!row.completed} onChange={(event) => update(row.id, { quality: event.target.value as VideoQuality })} className="rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-white">
              {QUALITIES.map((value) => <option key={value} value={value}>{qualityDisplay(value)}</option>)}
            </select>
          </label>
          <span className={row.status === "done" ? "text-green-400" : row.status === "error" ? "text-red-400" : "text-neutral-500"}>{row.status === "uploading" ? `${row.progress}%` : row.status}</span>
          {row.error && <span className="w-full text-red-400">{row.error}</span>}
        </div>)}
      </div>}
      {message && <p className="text-xs text-neutral-400">{message}</p>}
    </div>
  );
}
