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
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentsError, setCommentsError] = useState("");

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

  const toggleComments = async (commentsEnabled: boolean) => {
    setCommentsBusy(true);
    setCommentsError("");
    try {
      const response = await fetch(`/api/media/${media.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentsEnabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update comment settings.");
      setFullData((current) => current ? { ...current, commentsEnabled: data.commentsEnabled } : current);
    } catch (reason) {
      setCommentsError(reason instanceof Error ? reason.message : "Could not update comment settings.");
    } finally { setCommentsBusy(false); }
  };

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
        <div><p className="text-sm font-medium text-white">Title comments</p><p className="text-xs text-neutral-500">Turn off new title and episode comments for this media item.</p></div>
        <label className="flex min-h-10 items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={fullData.commentsEnabled ?? true} disabled={commentsBusy} onChange={(event) => void toggleComments(event.target.checked)} className="h-4 w-4 accent-red-500" />
          {fullData.commentsEnabled === false ? "Disabled" : "Enabled"}
        </label>
        {commentsError && <p role="alert" className="w-full text-sm text-red-400">{commentsError}</p>}
      </div>
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
