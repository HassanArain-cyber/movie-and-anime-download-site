"use client";

import { useState } from "react";
import type { DownloadLink } from "@/lib/types";

interface Props {
  mediaId: number;
  episodeId?: number;
  links: DownloadLink[];
  onChange: () => void;
}

export default function DownloadLinksEditor({
  mediaId,
  episodeId,
  links,
  onChange,
}: Props) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => {
    setLabel("");
    setUrl("");
    setFileSize("");
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!url.trim()) {
      setErr("URL is required");
      return;
    }
    try {
      const payload: any = {
        mediaId,
        episodeId: episodeId || null,
        label: label.trim() || "Download",
        url: url.trim(),
        fileSize: fileSize.trim() || null,
      };
      const res = editingId
        ? await fetch(`/api/download-links/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: payload.label,
              url: payload.url,
              fileSize: payload.fileSize,
            }),
          })
        : await fetch("/api/download-links", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      reset();
      onChange();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this link?")) return;
    await fetch(`/api/download-links/${id}`, { method: "DELETE" });
    onChange();
  };

  const startEdit = (l: DownloadLink) => {
    setEditingId(l.id);
    setLabel(l.label || "");
    setUrl(l.url);
    setFileSize(l.fileSize || "");
  };

  const handleVideoUpload = async (file: File) => {
    setUploading(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "video");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Upload failed");
      }
      const data = await res.json();
      setUrl(data.url);
      setFileSize(formatBytes(data.size));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Download Links {episodeId ? "(episode)" : ""}
      </h3>

      <div className="space-y-2">
        {links.length === 0 && (
          <p className="rounded-md bg-neutral-900 p-3 text-sm text-neutral-500 ring-1 ring-neutral-800">
            No links added yet.
          </p>
        )}
        {links.map((l) => (
          <div
            key={l.id}
            className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-900 p-3 ring-1 ring-neutral-800"
          >
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-200">
              {l.label}
            </span>
            <a
              href={l.url.startsWith("/") ? l.url : l.url}
              target="_blank"
              rel="noopener"
              className="min-w-0 flex-1 truncate text-sm text-red-400 hover:underline"
            >
              {l.url}
            </a>
            {l.fileSize && (
              <span className="text-xs text-neutral-500">{l.fileSize}</span>
            )}
            {l.isUploaded && (
              <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-[10px] uppercase text-green-400">
                Uploaded
              </span>
            )}
            <button
              onClick={() => startEdit(l)}
              className="rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:text-white"
            >
              Edit
            </button>
            <button
              onClick={() => del(l.id)}
              className="rounded border border-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/20"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <form
        onSubmit={submit}
        className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. 1080p, 720p)"
            className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
          <input
            type="text"
            value={fileSize}
            onChange={(e) => setFileSize(e.target.value)}
            placeholder="File size (e.g. 1.2 GB)"
            className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
          <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-400 hover:border-neutral-600 hover:text-white">
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleVideoUpload(f);
                e.target.value = "";
              }}
            />
            {uploading ? "Uploading…" : "↑ Upload video file"}
          </label>
        </div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Direct download URL (https://...)"
          className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          required
        />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          {editingId && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
          >
            {editingId ? "Update Link" : "Add Link"}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}
