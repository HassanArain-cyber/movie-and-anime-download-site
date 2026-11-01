"use client";

import { useState } from "react";
import type { SeasonWithEpisodes, EpisodeWithLinks } from "@/lib/types";
import DownloadLinksEditor from "./DownloadLinksEditor";

interface Props {
  mediaId: number;
  seasons: SeasonWithEpisodes[];
  onChange: () => void;
}

export default function SeasonEditor({ mediaId, seasons, onChange }: Props) {
  const [seasonNumber, setSeasonNumber] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const addSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!seasonNumber) {
      setErr("Season number is required");
      return;
    }
    const res = await fetch("/api/seasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId,
        seasonNumber: Number(seasonNumber),
        name: seasonName.trim() || null,
      }),
    });
    if (res.ok) {
      setSeasonNumber("");
      setSeasonName("");
      onChange();
    } else {
      const d = await res.json();
      setErr(d.error || "Failed");
    }
  };

  const deleteSeason = async (id: number) => {
    if (!confirm("Delete this season and all its episodes?")) return;
    await fetch(`/api/seasons/${id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Seasons
        </h3>
      </div>

      <div className="space-y-2">
        {seasons.length === 0 && (
          <p className="rounded-md bg-neutral-900 p-3 text-sm text-neutral-500 ring-1 ring-neutral-800">
            No seasons yet. Add one below.
          </p>
        )}
        {seasons.map((s) => (
          <div
            key={s.id}
            className="overflow-hidden rounded-md bg-neutral-900 ring-1 ring-neutral-800"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() =>
                  setExpandedSeason(expandedSeason === s.id ? null : s.id)
                }
                className="flex flex-1 items-center gap-2 text-left"
              >
                <svg
                  className={`h-4 w-4 text-neutral-400 transition ${
                    expandedSeason === s.id ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                <span className="font-medium text-white">
                  Season {s.seasonNumber}
                </span>
                {s.name && (
                  <span className="text-sm text-neutral-400">— {s.name}</span>
                )}
                <span className="ml-2 text-xs text-neutral-500">
                  ({s.episodes?.length || 0} episodes)
                </span>
              </button>
              <button
                onClick={() => deleteSeason(s.id)}
                className="rounded border border-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/20"
              >
                Delete
              </button>
            </div>
            {expandedSeason === s.id && (
              <div className="border-t border-neutral-800 bg-neutral-950 p-3">
                <EpisodeEditor
                  mediaId={mediaId}
                  seasonId={s.id}
                  episodes={s.episodes || []}
                  onChange={onChange}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={addSeason}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4"
      >
        <div className="flex-1 min-w-[120px]">
          <label className="mb-1 block text-xs font-medium text-neutral-400">
            Season #
          </label>
          <input
            type="number"
            min="1"
            value={seasonNumber}
            onChange={(e) => setSeasonNumber(e.target.value)}
            placeholder="1"
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>
        <div className="flex-[2] min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-neutral-400">
            Name (optional)
          </label>
          <input
            type="text"
            value={seasonName}
            onChange={(e) => setSeasonName(e.target.value)}
            placeholder="e.g. The Beginning"
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
        >
          + Add Season
        </button>
        {err && <p className="w-full text-sm text-red-400">{err}</p>}
      </form>
    </div>
  );
}

// Nested episode editor
function EpisodeEditor({
  mediaId,
  seasonId,
  episodes,
  onChange,
}: {
  mediaId: number;
  seasonId: number;
  episodes: EpisodeWithLinks[];
  onChange: () => void;
}) {
  const [epNumber, setEpNumber] = useState("");
  const [epTitle, setEpTitle] = useState("");
  const [epDuration, setEpDuration] = useState("");
  const [expandedEp, setExpandedEp] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const addEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!epNumber) {
      setErr("Episode number required");
      return;
    }
    const res = await fetch("/api/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId,
        seasonId,
        episodeNumber: Number(epNumber),
        title: epTitle.trim() || null,
        duration: epDuration.trim() || null,
      }),
    });
    if (res.ok) {
      setEpNumber("");
      setEpTitle("");
      setEpDuration("");
      onChange();
    } else {
      const d = await res.json();
      setErr(d.error || "Failed");
    }
  };

  const deleteEpisode = async (id: number) => {
    if (!confirm("Delete this episode?")) return;
    await fetch(`/api/episodes/${id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-3">
      {episodes.length === 0 && (
        <p className="text-sm text-neutral-500">No episodes yet.</p>
      )}
      <div className="space-y-2">
        {episodes.map((ep) => (
          <div
            key={ep.id}
            className="overflow-hidden rounded-md bg-neutral-900 ring-1 ring-neutral-800"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() =>
                  setExpandedEp(expandedEp === ep.id ? null : ep.id)
                }
                className="flex flex-1 items-center gap-2 text-left"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 text-xs font-semibold text-neutral-300">
                  {ep.episodeNumber}
                </span>
                <span className="text-sm text-white">
                  {ep.title || `Episode ${ep.episodeNumber}`}
                </span>
                {ep.duration && (
                  <span className="text-xs text-neutral-500">
                    {ep.duration}
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-500">
                  {ep.downloadLinks?.length || 0} links
                </span>
              </button>
              <button
                onClick={() => deleteEpisode(ep.id)}
                className="rounded border border-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/20"
              >
                Delete
              </button>
            </div>
            {expandedEp === ep.id && (
              <div className="border-t border-neutral-800 bg-neutral-950 p-3">
                <DownloadLinksEditor
                  mediaId={mediaId}
                  episodeId={ep.id}
                  links={ep.downloadLinks || []}
                  onChange={onChange}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={addEpisode}
        className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-3"
      >
        <div className="w-20">
          <label className="mb-1 block text-xs font-medium text-neutral-400">
            #
          </label>
          <input
            type="number"
            min="1"
            value={epNumber}
            onChange={(e) => setEpNumber(e.target.value)}
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1 block text-xs font-medium text-neutral-400">
            Title
          </label>
          <input
            type="text"
            value={epTitle}
            onChange={(e) => setEpTitle(e.target.value)}
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs font-medium text-neutral-400">
            Duration
          </label>
          <input
            type="text"
            value={epDuration}
            onChange={(e) => setEpDuration(e.target.value)}
            placeholder="24m"
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-white outline-none focus:border-neutral-700"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
        >
          + Ep
        </button>
        {err && <p className="w-full text-xs text-red-400">{err}</p>}
      </form>
    </div>
  );
}
