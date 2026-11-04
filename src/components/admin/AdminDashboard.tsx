"use client";

import { useState } from "react";
import BulkEpisodeLinks from "./BulkEpisodeLinks";
import BulkAddEpisodes from "./BulkAddEpisodes";
import MediaManager from "./MediaManager";
import CategoryManager from "./CategoryManager";
import AppearanceSettings from "./AppearanceSettings";
import ContactRequestsManager from "./ContactRequestsManager";
import CommentModerationManager from "./CommentModerationManager";

type Tab = "links" | "bulk" | "media" | "categories" | "appearance" | "requests" | "moderation";

export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [linksOpened, setLinksOpened] = useState(false);
  const [bulkOpened, setBulkOpened] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("media");

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-sm text-neutral-500">Manage your media library</p>
        </div>
        <button
          disabled={bulkBusy}
          onClick={handleLogout}
          className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:border-neutral-700 hover:text-white"
        >
          Log out
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-neutral-800">
        {(["media", "links", "bulk", "categories", "appearance", "requests", "moderation"] as Tab[]).map((t) => (
          <button
            key={t}
            disabled={bulkBusy}
            onClick={() => { if (t === "bulk") setBulkOpened(true); if (t === "links") setLinksOpened(true); setTab(t); }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium capitalize ${
              tab === t
                ? "border-red-500 text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t === "links" ? "Bulk Add Links" : t === "bulk" ? "Bulk Add Episodes" : t === "moderation" ? "Comment moderation" : t}
          </button>
        ))}
      </div>

      {linksOpened && <div hidden={tab !== "links"}><BulkEpisodeLinks onBusyChange={setBulkBusy} /></div>}
      {bulkOpened && <div hidden={tab !== "bulk"}><BulkAddEpisodes onBusyChange={setBulkBusy} /></div>}
      {tab === "bulk" || tab === "links" ? null : tab === "media" ? <MediaManager /> : tab === "categories" ? <CategoryManager /> : tab === "appearance" ? <AppearanceSettings /> : tab === "requests" ? <ContactRequestsManager /> : <CommentModerationManager />}
    </div>
  );
}
