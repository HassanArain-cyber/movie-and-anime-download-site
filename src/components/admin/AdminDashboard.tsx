"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./AdminCompact.module.css";
import RecycleBin from "./RecycleBin";
import BulkEpisodeLinks from "./BulkEpisodeLinks";
import BulkAddEpisodes from "./BulkAddEpisodes";
import MediaManager from "./MediaManager";
import CategoryManager from "./CategoryManager";
import AppearanceSettings from "./AppearanceSettings";
import CopyLinkSettings from "./CopyLinkSettings";
import ContactRequestsManager from "./ContactRequestsManager";
import CommentModerationManager from "./CommentModerationManager";

type Tab = "recycle" | "links" | "bulk" | "media" | "categories" | "appearance" | "requests" | "moderation";

export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [linksOpened, setLinksOpened] = useState(false);
  const [bulkOpened, setBulkOpened] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("media");

  const navigation = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previousTab = useRef(tab);
  useLayoutEffect(() => {
    const header = document.querySelector("header"), element = navigation.current;
    if (!element) return;
    const measure = () => element.style.setProperty("--admin-nav-top", `${header?.getBoundingClientRect().height ?? 0}px`);
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    if (previousTab.current === tab) return;
    previousTab.current = tab;
    const content = panel.current?.getBoundingClientRect(), nav = navigation.current?.getBoundingClientRect();
    // When switching from a deeply scrolled section, reveal the new section
    // below the sticky tabs instead of leaving its first controls off-screen.
    if (content && nav && content.top < nav.bottom) window.scrollBy({ top: content.top - nav.bottom - 8, behavior: "instant" });
  }, [tab]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  return (
    <div className={tab === "appearance" ? "space-y-6" : `${styles.compact} space-y-3`}>
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

      <div ref={navigation} role="navigation" aria-label="Admin sections" className={`${styles.navigation} flex gap-1 overflow-x-auto border-b border-neutral-800`}>
        {(["media", "links", "bulk", "categories", "appearance", "requests", "moderation", "recycle"] as Tab[]).map((t) => (
          <button
            key={t}
            disabled={bulkBusy}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => { if (t === "bulk") setBulkOpened(true); if (t === "links") setLinksOpened(true); setTab(t); }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 ${tab === "appearance" ? "px-4 py-2 text-sm" : "min-h-9 px-2 py-1.5 text-xs"} font-medium capitalize ${
              tab === t
                ? t === "appearance" ? "border-red-500 text-white" : "border-purple-500 text-white"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t === "recycle" ? "Recycle Bin" : t === "links" ? "Episodes" : t === "bulk" ? "File batches" : t === "moderation" ? "Comment moderation" : t}
          </button>
        ))}
      </div>

      <div ref={panel} className="min-w-0">
      {linksOpened && <div hidden={tab !== "links"}><BulkEpisodeLinks onBusyChange={setBulkBusy} /></div>}
      {bulkOpened && <div hidden={tab !== "bulk"}><BulkAddEpisodes onBusyChange={setBulkBusy} /></div>}
      {tab === "bulk" || tab === "links" ? null : tab === "recycle" ? <RecycleBin onBusyChange={setBulkBusy} /> : tab === "media" ? <MediaManager onBusyChange={setBulkBusy} /> : tab === "categories" ? <CategoryManager /> : tab === "appearance" ? <div className="space-y-6"><AppearanceSettings /><CopyLinkSettings /></div> : tab === "requests" ? <ContactRequestsManager onBusyChange={setBulkBusy} /> : <CommentModerationManager onBusyChange={setBulkBusy} />}
      </div>
    </div>
  );
}
