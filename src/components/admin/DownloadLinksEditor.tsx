"use client";

import { useEffect, useRef, useState } from "react";
import type { CompletedUpload, DownloadLink, StorageStatus, VideoQuality } from "@/lib/types";
import { formatBytes, getLinkProvider, getProviderLabel, getQuality, QUALITIES, qualityDisplay } from "@/lib/media-links";
import { uploadToR2, UploadError } from "@/lib/upload-client";

interface Props {
  mediaId: number;
  seasonId?: number;
  episodeId?: number;
  links: DownloadLink[];
  onChange: () => void | Promise<void>;
  kind?: "video" | "archive";
}

const inputClass = "rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700";

export default function DownloadLinksEditor({ mediaId, seasonId, episodeId, links, onChange, kind = "video" }: Props) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [quality, setQuality] = useState<VideoQuality>("1080p");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState<CompletedUpload | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resumeId, setResumeId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editingLink = links.find((link) => link.id === editingId);
  const editingStored = editingLink ? ["r2", "local"].includes(getLinkProvider(editingLink)) : false;

  useEffect(() => {
    let active = true;
    fetch("/api/storage/status").then((res) => res.ok ? res.json() : null).then((data) => { if (active) setStorage(data); }).catch(() => undefined);
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  const reset = () => {
    setLabel(""); setUrl(""); setFileSize(""); setQuality("1080p"); setEditingId(null);
    setCompleted(null); setSelectedFile(null); setResumeId(undefined); setProgress(0); setErr("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const startUpload = async (file: File, resume?: string) => {
    if (!storage?.configured) { setErr("Cloudflare R2 is not configured yet. External links still work."); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true); setErr(""); setCompleted(null); setSelectedFile(file); setProgress(0);
    try {
      const result = await uploadToR2(file, {
        kind, mediaId, seasonId, episodeId, quality, resumeId: resume, signal: controller.signal,
        onProgress: (percent) => setProgress(percent), onSession: setResumeId,
      });
      setCompleted(result); setFileSize(formatBytes(result.sizeBytes)); setResumeId(undefined);
      if (!label.trim()) setLabel(quality === "other" ? file.name : quality);
    } catch (error) {
      if ((error as Error).name === "AbortError") { setResumeId(undefined); setErr("Upload cancelled. No file was saved."); }
      else { setErr(error instanceof Error ? error.message : "Upload failed"); if (error instanceof UploadError) setResumeId(error.uploadId); }
    } finally { setUploading(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setErr("");
    if (!completed && !url.trim() && !editingStored) { setErr("Upload a file or enter an external URL"); return; }
    setSaving(true);
    try {
      const target = { mediaId, seasonId: seasonId ?? null, episodeId: episodeId ?? null, quality };
      const payload = {
        ...target, label: label.trim() || quality, fileSize: fileSize.trim() || null,
        ...(completed ? { r2UploadId: completed.id, url: completed.url } : editingStored ? {} : { url: url.trim() }),
      };
      const res = await fetch(editingId ? `/api/download-links/${editingId}` : "/api/download-links", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Failed to save link"); }
      reset(); await onChange();
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed to save link"); }
    finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this download link? The R2 file itself will be retained.")) return;
    setErr("");
    const res = await fetch(`/api/download-links/${id}`, { method: "DELETE" });
    if (!res.ok) { const data = await res.json(); setErr(data.error || "Delete failed"); return; }
    if (editingId === id) reset();
    await onChange();
  };

  const startEdit = (link: DownloadLink) => {
    abortRef.current?.abort(); setUploading(false);
    setEditingId(link.id); setLabel(link.label || ""); setUrl(link.url); setFileSize(link.fileSize || "");
    setQuality(getQuality(link) || "other"); setCompleted(null); setSelectedFile(null); setResumeId(undefined); setErr("");
  };

  const scope = episodeId ? "episode" : seasonId ? "complete season" : "movie";
  const accept = kind === "archive" ? ".zip,.rar,.7z" : ".mp4,.webm,.mkv,.mov,.avi,.m4v";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Download links · {scope}</h3>
        <span className="text-xs text-neutral-500">Private R2 files + Telegram/external links</span>
      </div>

      <div className="space-y-2">
        {links.length === 0 && <p className="rounded-md bg-neutral-900 p-3 text-sm text-neutral-500 ring-1 ring-neutral-800">No links added yet.</p>}
        {links.map((link) => {
          const provider = getLinkProvider(link);
          const linkQuality = getQuality(link);
          return (
            <div key={link.id} className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-900 p-3 ring-1 ring-neutral-800">
              <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-200">{link.label || "Download"}</span>
              {linkQuality && <span className="rounded bg-red-950/60 px-2 py-0.5 text-xs text-red-300">{qualityDisplay(linkQuality)}</span>}
              <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase text-neutral-400">{getProviderLabel(provider)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-400" title={link.url}>{provider === "r2" ? link.objectKey || link.url : link.url}</span>
              {link.fileSize && <span className="text-xs text-neutral-500">{link.fileSize}</span>}
              <button type="button" onClick={() => startEdit(link)} className="rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:text-white">Edit</button>
              <button type="button" onClick={() => del(link.id)} className="rounded border border-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/20">Delete</button>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} aria-label={`Download link form ${scope}`} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-neutral-400">Quality
            <select value={quality} onChange={(event) => setQuality(event.target.value as VideoQuality)} disabled={uploading || !!completed} className={`${inputClass} mt-1 w-full`}>
              {QUALITIES.map((value) => <option key={value} value={value}>{qualityDisplay(value)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-neutral-400">Label
            <input type="text" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. 1080p WEB-DL" maxLength={50} className={`${inputClass} mt-1 w-full`} />
          </label>
          <label className="space-y-1 text-xs text-neutral-400">File size
            <input type="text" value={fileSize} onChange={(event) => setFileSize(event.target.value)} placeholder="Auto-filled for R2" maxLength={30} className={`${inputClass} mt-1 w-full`} />
          </label>
        </div>

        <div className="rounded-md border border-dashed border-neutral-700 bg-neutral-950 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || !storage?.configured} className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50">
              {uploading ? `Uploading to R2… ${progress}%` : completed ? "Replace uploaded file" : kind === "archive" ? "↑ Upload season archive to R2" : "↑ Upload video to R2"}
            </button>
            {uploading && <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300">Cancel</button>}
            {!uploading && resumeId && selectedFile && <button type="button" onClick={() => startUpload(selectedFile, resumeId)} className="rounded-md border border-red-800 px-3 py-2 text-sm text-red-300">Resume upload</button>}
            <span className="text-xs text-neutral-500">{kind === "archive" ? "ZIP, RAR, 7z" : "MP4, WebM, MKV, MOV, AVI, M4V"} · direct to private R2</span>
          </div>
          <input ref={fileRef} type="file" accept={accept} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void startUpload(file); event.target.value = ""; }} />
          {uploading && <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-red-500 transition-all" style={{ width: `${progress}%` }} /></div>}
          {completed && <p className="mt-2 text-xs text-green-400">Uploaded and verified in R2: {completed.fileName} ({formatBytes(completed.sizeBytes)}). Save the link to attach it.</p>}
          {storage && !storage.configured && <p className="mt-2 text-xs text-yellow-400">R2 uploads are disabled until the server sets: {storage.missing.join(", ")}. You can still add Telegram/external links.</p>}
        </div>

        {!editingStored && !completed && (
          <label className="block space-y-1 text-xs text-neutral-400">External URL
            <input type="text" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://t.me/…, https://…, tg://…, or magnet:…" className={`${inputClass} mt-1 w-full`} />
          </label>
        )}
        {editingStored && !completed && <p className="text-xs text-neutral-500">Existing stored file is preserved. Upload a replacement above, or edit only the label/quality/size.</p>}
        {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          {editingId && <button type="button" onClick={reset} className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:text-white">Cancel</button>}
          <button type="submit" disabled={saving || uploading || (!completed && !url.trim() && !editingStored)} className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
            {saving ? "Saving…" : editingId ? "Update link" : "Add link"}
          </button>
        </div>
      </form>
    </div>
  );
}
