"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import ImageUploader from "./ImageUploader";
import MediaWizard from "./MediaWizard";
import type { MediaType } from "@/lib/types";

interface Props {
  categories: Category[];
  editing?: any;
  initialType?: MediaType;
  onBusyChange?: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (item: any) => void;
}

const TYPES = [
  { value: "movie", label: "Movie" },
  { value: "anime", label: "Anime" },
  { value: "series", label: "TV Series" },
];

export default function MediaForm(props: Props) {
  return props.editing ? <DetailsForm {...props} /> : <MediaWizard categories={props.categories} initialType={props.initialType} onCancel={props.onCancel} onSaved={props.onSaved} onBusyChange={props.onBusyChange} />;
}

function DetailsForm({ categories, editing, onCancel, onSaved }: Props) {
  const [type, setType] = useState(editing?.type || "movie");
  const [title, setTitle] = useState(editing?.title || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [year, setYear] = useState<string>(editing?.year ? String(editing.year) : "");
  const [categoryId, setCategoryId] = useState<string>(
    editing?.categoryId ? String(editing.categoryId) : ""
  );
  const [posterUrl, setPosterUrl] = useState(editing?.posterUrl || "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        type,
        title: title.trim(),
        description: description.trim(),
        year: year ? Number(year) : null,
        categoryId: categoryId ? Number(categoryId) : null,
        posterUrl,
      };
      const url = editing ? `/api/media/${editing.id}` : "/api/media";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Save failed");
      }
      const saved = await res.json();
      onSaved(saved);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">
          {editing ? "Edit Media" : "Add New Media"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← Back
        </button>
      </div>

      <div className="grid gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4 md:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="media-type" className="text-xs font-medium text-neutral-400">Type</label>
          <select
            id="media-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={!!editing}
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700 disabled:opacity-60"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="media-title" className="text-xs font-medium text-neutral-400">Title</label>
          <input
            id="media-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="media-year" className="text-xs font-medium text-neutral-400">Year</label>
          <input
            id="media-year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2024"
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="media-category" className="text-xs font-medium text-neutral-400">Category</label>
          <select
            id="media-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1 md:col-span-2">
          <label htmlFor="media-description" className="text-xs font-medium text-neutral-400">Description</label>
          <textarea
            id="media-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <label className="text-xs font-medium text-neutral-400">Poster Image</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
          <ImageUploader
            currentUrl={posterUrl}
            onUpload={(url) => setPosterUrl(url)}
            mediaId={editing?.id}
          />
          <div className="flex-1 space-y-2">
            <input
              type="text"
              value={posterUrl}
              onChange={(e) => setPosterUrl(e.target.value)}
              placeholder="Or paste an image URL…"
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
            />
            <p className="text-xs text-neutral-500">
              2:3 portrait ratio recommended. Upload or paste a direct URL.
            </p>
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {loading ? "Saving…" : editing ? "Save Changes" : "Create & Continue"}
        </button>
      </div>
    </form>
  );
}
