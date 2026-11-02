"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadToR2 } from "@/lib/upload-client";
import type { Media, StorageStatus } from "@/lib/types";

interface GalleryImage {
  url: string;
  title: string;
}

function galleryImages(items: Media[]): GalleryImage[] {
  const seen = new Set<string>();
  const images: GalleryImage[] = [];
  for (const item of items) {
    for (const [label, url] of [["poster", item.posterUrl], ["thumbnail", item.thumbnailUrl]] as const) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      images.push({ url, title: `${item.title} · ${label}` });
    }
  }
  return images;
}

function ImagePreview({ url, label }: { url: string | null; label: string }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      {url ? <>
        <Image src={url} alt="" fill sizes="(max-width: 640px) 100vw, 50vw" unoptimized className="object-cover" />
        <div className="absolute inset-0 bg-black/60" />
        <p className="absolute inset-x-3 bottom-3 text-sm font-medium text-white">{label}</p>
      </> : <div className="flex h-full items-center justify-center text-sm text-neutral-600">No wallpaper selected</div>}
    </div>
  );
}

export default function AppearanceSettings() {
  const [media, setMedia] = useState<Media[]>([]);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const images = useMemo(() => galleryImages(media), [media]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/site-settings", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Could not load the saved wallpaper");
        return response.json() as Promise<{ wallpaperUrl: string | null }>;
      }),
      fetch("/api/media").then(async (response) => {
        if (!response.ok) throw new Error("Could not load the image gallery");
        return response.json() as Promise<Media[]>;
      }),
      fetch("/api/storage/status").then((response) => response.ok ? response.json() as Promise<StorageStatus> : null),
    ]).then(([settings, items, storageStatus]) => {
      if (!active) return;
      setCurrent(settings.wallpaperUrl);
      setCandidate(settings.wallpaperUrl);
      setCandidateName(settings.wallpaperUrl ? "Current wallpaper" : "");
      setMedia(Array.isArray(items) ? items : []);
      setStorage(storageStatus);
      setError("");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load appearance settings");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  const handleUpload = async (file: File) => {
    if (!storage?.configured) { setError("Cloudflare R2 is not configured. Choose an existing gallery image instead."); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true); setProgress(0); setError(""); setMessage("");
    try {
      const result = await uploadToR2(file, {
        kind: "image", signal: controller.signal,
        onProgress: (percent) => setProgress(percent),
      });
      if (!result.imageUrl) throw new Error("R2 did not return a completed image URL");
      setCandidate(result.imageUrl);
      setCandidateName(file.name);
      setMessage("Upload complete. Preview the image, then apply it to the site.");
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") setError(reason instanceof Error ? reason.message : "Wallpaper upload failed");
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setUploading(false); }
    }
  };

  const apply = async () => {
    if (!candidate || saving || uploading) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/site-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallpaperUrl: candidate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not apply wallpaper");
      setCurrent(data.wallpaperUrl);
      setCandidate(data.wallpaperUrl);
      setMessage("Wallpaper applied and saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply wallpaper"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!current || saving || uploading) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/site-settings", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove wallpaper");
      setCurrent(null); setCandidate(null); setCandidateName("");
      setMessage("Wallpaper removed. The private R2 image itself was retained.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove wallpaper"); }
    finally { setSaving(false); }
  };

  const selectGalleryImage = (image: GalleryImage) => {
    setCandidate(image.url);
    setCandidateName(image.title);
    setError(""); setMessage("");
  };

  if (loading) return <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-500">Loading appearance settings…</p>;

  return (
    <section className="space-y-5 rounded-xl border border-neutral-800 bg-neutral-950/90 p-4 sm:p-6" aria-labelledby="appearance-heading">
      <div>
        <h2 id="appearance-heading" className="text-lg font-semibold text-white">Website background wallpaper</h2>
        <p className="mt-1 text-sm text-neutral-400">Choose an existing media poster/thumbnail or upload an image to your private R2 bucket. The original media files and posters are not changed.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Currently applied</h3>
          <ImagePreview url={current} label="Live site wallpaper" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Preview selection</h3>
          <ImagePreview url={candidate} label={candidateName || "Preview"} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={uploading || saving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleUpload(file); event.target.value = ""; }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading || saving || !storage?.configured} className="rounded-md border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50">
          {uploading ? `Uploading to private R2… ${progress}%` : current ? "Upload replacement" : "Upload wallpaper"}
        </button>
        {uploading && <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-400 hover:text-white">Cancel upload</button>}
        <button type="button" onClick={() => void apply()} disabled={!candidate || candidate === current || saving || uploading} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "Saving…" : current ? "Replace wallpaper" : "Apply wallpaper"}
        </button>
        <button type="button" onClick={() => void remove()} disabled={!current || saving || uploading} className="rounded-md border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50">Remove wallpaper</button>
      </div>
      {uploading && <div className="h-2 overflow-hidden rounded bg-neutral-800" role="progressbar" aria-label="Wallpaper upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full bg-red-500 transition-all" style={{ width: `${progress}%` }} /></div>}
      {!storage?.configured && <p className="text-xs text-amber-300">R2 is not configured, so new uploads are unavailable. Existing gallery images can still be applied.</p>}

      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Choose from the website image gallery</h3>
          <p className="text-xs text-neutral-500">Gallery options are existing media posters and thumbnails.</p>
        </div>
        {images.length === 0 ? <p className="rounded-md border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">No media gallery images are available yet. Upload a wallpaper above.</p> : (
          <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image) => <button key={image.url} type="button" aria-pressed={candidate === image.url} onClick={() => selectGalleryImage(image)} className={`overflow-hidden rounded-lg border text-left transition ${candidate === image.url ? "border-red-500 ring-1 ring-red-500" : "border-neutral-800 hover:border-neutral-600"}`}>
              <div className="relative aspect-video bg-neutral-900"><Image src={image.url} alt="" fill sizes="(max-width: 640px) 50vw, 25vw" unoptimized className="object-cover" /></div>
              <span className="block truncate px-2 py-1.5 text-xs text-neutral-300" title={image.title}>{image.title}</span>
            </button>)}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-neutral-300">{message}</p>}
    </section>
  );
}
