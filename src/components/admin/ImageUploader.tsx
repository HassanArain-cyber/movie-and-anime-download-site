"use client";

import { useState, useRef } from "react";
import Image from "next/image";

interface Props {
  currentUrl?: string;
  onUpload: (url: string) => void;
  aspect?: string; // CSS aspect ratio
}

export default function ImageUploader({
  currentUrl,
  onUpload,
  aspect = "aspect-[2/3]",
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "image");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Upload failed");
      }
      const data = await res.json();
      onUpload(data.url);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={`relative w-32 shrink-0 ${aspect} overflow-hidden rounded-md border border-dashed border-neutral-700 bg-neutral-950`}
    >
      {currentUrl ? (
        <Image
          src={currentUrl}
          alt="poster"
          fill
          sizes="128px"
          className="object-cover"
          unoptimized={
            currentUrl.startsWith("data:") || currentUrl.startsWith("http")
          }
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-neutral-600">
          No image
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-xs font-medium text-white hover:bg-black/90 disabled:opacity-50"
      >
        {uploading ? "Uploading…" : currentUrl ? "Replace" : "Upload"}
      </button>

      {currentUrl && (
        <button
          type="button"
          onClick={() => onUpload("")}
          className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white hover:bg-red-600"
          title="Remove image"
        >
          ×
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      {err && (
        <p className="absolute inset-x-0 top-0 bg-red-600/90 px-1 py-0.5 text-center text-[10px] text-white">
          {err}
        </p>
      )}
    </div>
  );
}
