"use client";

import { useEffect, useState } from "react";
import MediaForm from "./MediaForm";
import DownloadLinksEditor from "./DownloadLinksEditor";
import SeasonEditor from "./SeasonEditor";
import type { Media, Category, SeasonWithEpisodes, DownloadLink } from "@/lib/types";

interface Props {
  media: Media;
  categories: Category[];
  onCancel: () => void;
  onUpdated: () => void;
}

export default function MediaEditor({ media, categories, onCancel, onUpdated }: Props) {
  const [fullData, setFullData] = useState<any>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/media/${media.id}`);
    const data = await res.json();
    setFullData(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id]);

  if (loading || !fullData) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={onCancel}
            className="text-sm text-neutral-400 hover:text-white"
          >
            ← Back to media
          </button>
          <h2 className="mt-1 text-xl font-bold text-white">
            {fullData.title}
            <span className="ml-2 rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-normal capitalize text-neutral-300">
              {fullData.type}
            </span>
          </h2>
        </div>
        <button
          onClick={() => setShowEditForm((v) => !v)}
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:text-white"
        >
          {showEditForm ? "Close Edit" : "Edit Details"}
        </button>
      </div>

      {showEditForm && (
        <MediaForm
          categories={categories}
          editing={fullData}
          onCancel={() => setShowEditForm(false)}
          onSaved={() => {
            setShowEditForm(false);
            onUpdated();
          }}
        />
      )}

      {/* Movies: just download links */}
      {fullData.type === "movie" && (
        <DownloadLinksEditor
          mediaId={fullData.id}
          links={fullData.downloadLinks || []}
          onChange={load}
        />
      )}

      {/* Series/Anime: seasons and episodes */}
      {fullData.type !== "movie" && (
        <SeasonEditor
          mediaId={fullData.id}
          seasons={fullData.seasons || []}
          onChange={load}
        />
      )}
    </div>
  );
}
