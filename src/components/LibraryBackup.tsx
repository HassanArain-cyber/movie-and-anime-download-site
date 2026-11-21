"use client";

import { useRef, useState } from "react";
import { CALENDAR_FOLLOWS_CHANGED, CALENDAR_FOLLOWS_KEY } from "@/lib/calendar-follows";
import {
  CONTINUE_EPISODES_KEY, MAX_BACKUP_BYTES, WATCHED_EPISODES_KEY,
  createLibraryBackup, mergeLibraryBackup, parseLibraryBackup,
} from "@/lib/library-backup";
import type { FollowedTitle } from "@/components/UpdatesProvider";

type Props = {
  followedTitles: FollowedTitle[] | null;
  refreshFollows: () => Promise<void>;
};

function readSavedJson(key: string, fallback: unknown): unknown {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch { return fallback; }
}

function readCurrentBackup(follows: FollowedTitle[]) {
  return createLibraryBackup({
    vaultFollows: follows.map(({ id, watchStatus }) => ({ id, watchStatus })),
    calendarFollows: readSavedJson(CALENDAR_FOLLOWS_KEY, []),
    watchedEpisodes: readSavedJson(WATCHED_EPISODES_KEY, {}),
    continueWatching: readSavedJson(CONTINUE_EPISODES_KEY, []),
  });
}

function downloadBackup(data: string) {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vault-library-" + new Date().toISOString().slice(0, 10) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LibraryBackup({ followedTitles, refreshFollows }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const exportBackup = () => {
    if (!followedTitles) return;
    try {
      const backup = readCurrentBackup(followedTitles);
      const json = JSON.stringify(backup, null, 2);
      // Do not download a file that the Import button cannot read back.
      if (new Blob([json]).size > MAX_BACKUP_BYTES) {
        throw new Error("Your library backup exceeds the supported file size.");
      }
      downloadBackup(json);
      setError("");
      setNotice("Library backup downloaded. Keep this file somewhere safe.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read your saved library.");
    }
  };

  const restoreBackup = async (file: File) => {
    if (!followedTitles || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup file is too large.");
      const incoming = parseLibraryBackup(await file.text());
      const local = readCurrentBackup(followedTitles);
      const merged = mergeLibraryBackup(local, incoming);

      if (!window.confirm("Merge this backup with your current library? Existing follows and watched episodes will be kept.")) return;

      // Server follows are restored first. Never alter local storage if this fails.
      let restored = 0;
      let unavailable = 0;
      if (incoming.vaultFollows.length) {
        const response = await fetch("/api/library-backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ follows: incoming.vaultFollows }),
        });
        const data = await response.json() as { imported?: number; unavailable?: number; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not restore Vault follows.");
        restored = data.imported ?? 0;
        unavailable = data.unavailable ?? 0;
      }

      localStorage.setItem(CALENDAR_FOLLOWS_KEY, JSON.stringify(merged.calendarFollows));
      localStorage.setItem(WATCHED_EPISODES_KEY, JSON.stringify(merged.watchedEpisodes));
      localStorage.setItem(CONTINUE_EPISODES_KEY, JSON.stringify(merged.continueWatching));
      window.dispatchEvent(new Event(CALENDAR_FOLLOWS_CHANGED));
      window.dispatchEvent(new Event("vault-continue-updated"));
      await refreshFollows();
      setNotice("Backup merged. " + restored + " Vault follows restored" +
        (unavailable ? " (" + unavailable + " no longer available)" : "") + ".");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import your backup.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section aria-label="Backup your library" className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white">Backup &amp; restore library</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">
            Save your Vault follows, calendar anime, watched episodes and recently opened episodes.
            Import merges your lists without deleting existing items. No account required.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportBackup} disabled={!followedTitles || busy}
            className="min-h-10 rounded-lg border border-violet-400/35 bg-violet-500/15 px-3 text-xs font-semibold text-violet-100 disabled:opacity-50">
            Export backup
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={!followedTitles || busy}
            className="min-h-10 rounded-lg border border-white/15 bg-neutral-800 px-3 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? "Restoring…" : "Import backup"}
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden"
            aria-label="Choose a Vault library backup" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void restoreBackup(file);
            }} />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">Backup contains only your library choices, not passwords or admin settings. Keep the file private.</p>
      {notice && <p role="status" className="mt-2 text-xs text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
}
