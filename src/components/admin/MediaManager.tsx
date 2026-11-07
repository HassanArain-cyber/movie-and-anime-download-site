"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./MediaSearch.module.css";
import MediaForm from "./MediaForm";
import MediaEditor from "./MediaEditor";
import type { Media, Category, MediaType } from "@/lib/types";

export default function MediaManager({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [items, setItems] = useState<Media[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Media | null>(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<MediaType | "">("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    // Focus in the opening commit, not after the CSS transition or a timer.
    // The input is already mounted; inert/visibility are removed before focus.
    if (searchOpen) searchInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);
  const closeSearch = () => { setSearchOpen(false); setFilter(""); searchToggle.current?.focus(); };
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [mediaRes, catRes] = await Promise.all([fetch("/api/media"), fetch("/api/categories")]);
      const mediaData = await mediaRes.json();
      const catData = await catRes.json();
      if (!mediaRes.ok) throw new Error(mediaData.error || "Failed to load media");
      if (!catRes.ok) throw new Error(catData.error || "Failed to load categories");
      setItems(Array.isArray(mediaData) ? mediaData : []);
      setCategories(Array.isArray(catData) ? catData : []);
      setErr("");
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/media").then((res) => res.json()), fetch("/api/categories").then((res) => res.json())])
      .then(([mediaData, catData]) => {
        if (!active) return;
        setItems(Array.isArray(mediaData) ? mediaData : []);
        setCategories(Array.isArray(catData) ? catData : []);
        setLoading(false);
      })
      .catch(() => { if (active) { setErr("Failed to load media"); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const del = async (id: number) => {
    if (!confirm("Move this title to the Recycle Bin? Its seasons, episodes, comments, links and R2 files will be retained for recovery.")) return;
    const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
    if (res.ok) await load(); else { const data = await res.json(); setErr(data.error || "Delete failed"); }
  };

  const filtered = items
    .filter((item) => !kind || item.type === kind)
    .filter((item) => !filter || item.title.toLowerCase().includes(filter.toLowerCase()) || item.type.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));

  if (creating) return <MediaForm onBusyChange={onBusyChange} initialType={kind || "movie"} categories={categories} onCancel={() => setCreating(false)} onSaved={async (newItem) => { setCreating(false); await load(); setEditing(newItem as Media); }} />;
  if (editing) return <MediaEditor onBusyChange={onBusyChange} media={editing} categories={categories} onCancel={() => { setEditing(null); void load(); }} onUpdated={async () => { await load(); const res = await fetch(`/api/media/${editing.id}`); if (res.ok) setEditing(await res.json()); }} />;

  return (
    <div className="min-w-0 space-y-2">
      <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2">
        <h2 className="text-sm font-semibold text-white">Media library</h2>
        <p className="mt-0.5 text-xs text-neutral-500">Create a title or select one to manage.</p>
        <div role="group" aria-label="Media sections" className="mt-1.5 flex flex-wrap gap-1">
          {([ ["", "All media"], ["movie", "Movies"], ["anime", "Anime"], ["series", "Series"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`min-h-9 rounded-md border px-2 py-1 text-xs ${kind === value ? "border-purple-500/50 bg-purple-500/15 text-purple-200" : "border-neutral-800 text-neutral-400"}`}>{label}<span className="ml-1 text-[11px] text-neutral-500">{items.filter((item) => !value || item.type === value).length}</span></button>)}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className={styles.shell} data-open={searchOpen} data-testid="media-search-shell">
            <button ref={searchToggle} type="button" aria-label="Search media" title="Search media" aria-expanded={searchOpen} aria-controls="admin-media-search" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)} className={styles.toggle}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg></button>
            <div id="admin-media-search" className={styles.field} inert={!searchOpen} aria-hidden={!searchOpen}>
              <input ref={searchInput} type="search" aria-label="Filter media by title or type" value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }} placeholder="Filter by title or type…" className={styles.input} />
              <button type="button" aria-label="Close media search" title="Close search and clear filter" onClick={closeSearch} className={styles.close}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="min-h-9 shrink-0 rounded-md bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500">+ Add media</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {loading ? <p className="p-4 text-sm text-neutral-500">Loading…</p> : (
        <div className="min-w-0 rounded-lg border border-neutral-800">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-neutral-900 text-xs uppercase text-neutral-500"><tr><th className="px-2 py-1.5">Title</th><th className="hidden px-2 py-1.5 sm:table-cell">Type</th><th className="hidden px-2 py-1.5 sm:table-cell">Year</th><th className="hidden px-2 py-1.5 md:table-cell">Category</th><th className="px-2 py-1.5 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-neutral-900">
              {filtered.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">No media yet. Click &quot;Add media&quot; to start.</td></tr> : filtered.map((item) => (
                <tr key={item.id} className="hover:bg-neutral-900/40">
                  <td className="px-2 py-1.5"><button type="button" onClick={() => setEditing(item)} className="min-h-9 break-words text-left font-medium text-white hover:text-purple-300">{item.title}</button></td>
                  <td className="hidden px-2 py-1.5 sm:table-cell"><span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs capitalize text-neutral-300">{item.type}</span></td>
                  <td className="hidden px-2 py-1.5 text-neutral-400 sm:table-cell">{item.year || "—"}</td>
                  <td className="hidden px-2 py-1.5 text-neutral-400 md:table-cell">{item.categoryName || "—"}</td>
                  <td className="px-2 py-1.5"><div className="flex flex-wrap justify-end gap-1">
                    <button type="button" onClick={() => setEditing(item)} className="min-h-9 rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:text-white">Edit</button>
                    <button type="button" onClick={() => void del(item.id)} className="min-h-9 rounded-md border border-red-900/40 px-2 py-1 text-xs text-red-400 hover:bg-red-900/20">Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
