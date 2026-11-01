"use client";

import { useCallback, useEffect, useState } from "react";
import MediaForm from "./MediaForm";
import DownloadLinksEditor from "./DownloadLinksEditor";
import SeasonEditor from "./SeasonEditor";
import type { Media, Category, MediaWithRelations } from "@/lib/types";

interface Props { media: Media; categories: Category[]; onCancel: () => void; onUpdated: () => void | Promise<void>; }

export default function MediaEditor({ media, categories, onCancel, onUpdated }: Props) {
  const [fullData, setFullData] = useState<MediaWithRelations | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/${media.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load media");
      setFullData(data); setErr("");
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed to load media"); }
    finally { setLoading(false); }
  }, [media.id]);

  useEffect(() => {
    let active = true;
    fetch(`/api/media/${media.id}`).then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!active) return;
        if (ok) setFullData(data); else setErr(data.error || "Failed to load media");
        setLoading(false);
      })
      .catch(() => { if (active) { setErr("Failed to load media"); setLoading(false); } });
    return () => { active = false; };
  }, [media.id]);

  if (loading) return <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">Loading…</div>;
  if (!fullData) return <div role="alert" className="rounded-lg border border-red-900 bg-neutral-900 p-8 text-center text-red-400">{err || "Media not found"}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button type="button" onClick={onCancel} className="text-sm text-neutral-400 hover:text-white">← Back to media</button>
          <h2 className="mt-1 text-xl font-bold text-white">{fullData.title}<span className="ml-2 rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-normal capitalize text-neutral-300">{fullData.type}</span></h2>
        </div>
        <button type="button" onClick={() => setShowEditForm((value) => !value)} className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:text-white">{showEditForm ? "Close edit" : "Edit details"}</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {showEditForm && <MediaForm categories={categories} editing={fullData} onCancel={() => setShowEditForm(false)} onSaved={async () => { setShowEditForm(false); await onUpdated(); await load(); }} />}
      {fullData.type === "movie" ? (
        <DownloadLinksEditor mediaId={fullData.id} links={fullData.downloadLinks || []} onChange={load} />
      ) : (
        <SeasonEditor mediaId={fullData.id} seasons={fullData.seasons || []} onChange={load} />
      )}
      {fullData.type !== "movie" && (fullData.downloadLinks?.length || 0) > 0 && (
        <DownloadLinksEditor mediaId={fullData.id} links={fullData.downloadLinks || []} onChange={load} />
      )}
    </div>
  );
}
