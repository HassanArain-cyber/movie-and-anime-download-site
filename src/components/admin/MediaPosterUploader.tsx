"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { uploadToR2 } from "@/lib/upload-client";
import { needsUnoptimizedImage } from "@/lib/media-links";
import type { StorageStatus } from "@/lib/types";

interface Props {
  currentUrl?: string;
  onUpload: (url: string) => void;
  aspect?: string;
  mediaId?: number;
  onBusyChange: (busy: boolean) => void;
}

export default function MediaPosterUploader({ currentUrl, onUpload, aspect = "aspect-[2/3]", mediaId, onBusyChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/storage/status").then((res) => res.ok ? res.json() : null).then((data) => { if (active) setStorage(data); }).catch(() => undefined);
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  const handleFile = async (file: File) => {
    if (!storage?.configured) { setErr("R2 is not configured. Paste an image URL instead."); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setErr(""); setUploading(true); onBusyChange(true); setProgress(0);
    try {
      const result = await uploadToR2(file, { kind: "image", mediaId, signal: controller.signal, onProgress: setProgress });
      if (result.imageUrl) onUpload(result.imageUrl);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setErr(error instanceof Error ? error.message : "Upload failed");
    } finally { setUploading(false); onBusyChange(false); }
  };

  return (
    <div className="space-y-1">
      <div className={`relative w-32 shrink-0 ${aspect} overflow-hidden rounded-md border border-dashed border-neutral-700 bg-neutral-950`}>
        {currentUrl ? (
          <Image src={currentUrl} alt="Poster preview" fill sizes="128px" className="object-cover" unoptimized={needsUnoptimizedImage(currentUrl)} />
        ) : <div className="flex h-full w-full items-center justify-center text-xs text-neutral-600">No image</div>}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading || !storage?.configured} className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-xs font-medium text-white hover:bg-black/90 disabled:opacity-50">
          {uploading ? `R2 ${progress}%` : currentUrl ? "Replace" : "Upload to R2"}
        </button>
        {currentUrl && <button type="button" onClick={() => onUpload("")} className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white hover:bg-red-600" title="Remove image">×</button>}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }} />
      </div>
      {uploading && <button type="button" onClick={() => abortRef.current?.abort()} className="text-xs text-neutral-400 hover:text-white">Cancel upload</button>}
      {err && <p role="alert" className="max-w-40 text-xs text-red-400">{err}</p>}
      {storage && !storage.configured && <p className="max-w-40 text-[10px] text-yellow-500">R2 not configured; image URL still works.</p>}
    </div>
  );
}
