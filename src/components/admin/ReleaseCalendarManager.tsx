"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalendarKind, ManualCalendarEntry } from "@/lib/calendar-model";

type FormState = {
  id: string | null;
  title: string;
  kind: CalendarKind;
  airingAt: string;
  episode: string;
  anilistId: string;
  posterUrl: string;
  url: string;
  notes: string;
};
const EMPTY: FormState = { id: null, title: "", kind: "episode", airingAt: "", episode: "", anilistId: "", posterUrl: "", url: "", notes: "" };
const inputClass = "w-full min-w-0 rounded-lg border border-slate-700 bg-[#0c1525] px-3 py-2.5 text-sm text-white outline-none transition focus:border-sky-400";
const labelClass = "block space-y-1.5 text-xs font-semibold text-slate-300";
function localTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export default function ReleaseCalendarManager() {
  const [items, setItems] = useState<ManualCalendarEntry[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const update = (field: keyof FormState, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/calendar", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.entries)) throw new Error(result.error || "Could not load releases");
      setItems(result.entries);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load releases");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const reset = () => setForm({ ...EMPTY });
  const edit = (item: ManualCalendarEntry) => {
    setForm({
      id: item.id, title: item.title, kind: item.kind, airingAt: localTime(item.airingAt),
      episode: item.episode?.toString() ?? "", anilistId: item.anilistId?.toString() ?? "",
      posterUrl: item.posterUrl ?? "", url: item.url ?? "", notes: item.notes ?? "",
    });
    setNotice("");
    document.getElementById("calendar-admin-editor")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.airingAt || !Number.isFinite(new Date(form.airingAt).getTime())) { setError("Choose a valid date and time"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/calendar", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          title: form.title.trim(), kind: form.kind,
          airingAt: new Date(form.airingAt).toISOString(),
          episode: form.kind === "episode" && form.episode.trim() ? Number(form.episode) : null,
          anilistId: form.anilistId.trim() ? Number(form.anilistId) : null,
          posterUrl: form.posterUrl.trim() || null,
          url: form.url.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.entries)) throw new Error(result.error || "Could not save release");
      setItems(result.entries);
      setNotice(form.id ? "Release updated." : "Release added to calendar.");
      reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save release"); }
    finally { setSaving(false); }
  };

  const remove = async (item: ManualCalendarEntry) => {
    if (saving || deleting || !window.confirm("Delete " + item.title + " from the calendar?")) return;
    setDeleting(item.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/calendar", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.entries)) throw new Error(result.error || "Could not delete release");
      setItems(result.entries);
      if (form.id === item.id) reset();
      setNotice("Release deleted.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete release"); }
    finally { setDeleting(null); }
  };

  return <section aria-labelledby="admin-calendar-heading" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="admin-calendar-heading" className="text-xl font-bold text-white">Release Calendar</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Manage manual release dates. Automatic AniList/MAL schedules appear separately on the public calendar.</p></div>
      <a href="/calendar" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-sky-600/40 bg-sky-950/30 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-900/30">View public calendar ↗</a>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-200">{notice}</p>}

    <form id="calendar-admin-editor" onSubmit={save} className="space-y-4 rounded-xl border border-sky-800/50 bg-[#101a2c] p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">{form.id ? "Edit release" : "Add release"}</h3>
        {form.id && <button type="button" onClick={reset} className="text-xs text-sky-300 hover:text-white">Cancel edit</button>}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className={labelClass}>Anime / release title
          <input className={inputClass} required maxLength={160} value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Anime title" />
        </label>
        <label className={labelClass}>Release type
          <select className={inputClass} value={form.kind} onChange={(e) => setForm((current) => ({ ...current, kind: e.target.value as CalendarKind, episode: e.target.value === "episode" ? current.episode : "" }))}>
            <option value="episode">Episode</option><option value="new-series">New Series</option><option value="movie">Movie</option><option value="special">Special</option>
          </select>
        </label>
        <label className={labelClass}>Date and time (your device local time)
          <input className={inputClass} type="datetime-local" required value={form.airingAt} onChange={(e) => update("airingAt", e.target.value)} />
        </label>
        <label className={labelClass}>Episode number
          <input className={inputClass} type="number" min={1} max={100000} disabled={form.kind !== "episode"} value={form.episode} onChange={(e) => update("episode", e.target.value)} placeholder="e.g. 12" />
        </label>
        <label className={labelClass}>Poster image URL (optional)
          <input className={inputClass} type="url" value={form.posterUrl} onChange={(e) => update("posterUrl", e.target.value)} placeholder="https://..." />
        </label>
        <label className={labelClass}>Vault page or source link (optional)
          <input className={inputClass} value={form.url} onChange={(e) => update("url", e.target.value)} placeholder="/anime/slug or https://..." />
        </label>
        <label className={labelClass}>AniList anime ID (optional)
          <input className={inputClass} type="number" min={1} value={form.anilistId} onChange={(e) => update("anilistId", e.target.value)} placeholder="Use with episode to override a live date" />
        </label>
        <label className={labelClass}>Extra details (optional)
          <input className={inputClass} maxLength={240} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Sub / dub, extra notes..." />
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">Set AniList ID + episode number to replace the corresponding automatic entry. Blank fields do not invent poster art or episode counts. Public calendar displays dates in PKT.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving || loading || Boolean(deleting)} className="min-h-10 rounded-lg bg-gradient-to-r from-sky-700 to-blue-700 px-5 py-2 text-xs font-bold text-white hover:from-sky-600 hover:to-blue-600 disabled:opacity-50">{saving ? "Saving…" : form.id ? "Save changes" : "Add to calendar"}</button>
        <button type="button" onClick={reset} className="min-h-10 rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">Clear form</button>
      </div>
    </form>

    <div className="overflow-hidden rounded-xl border border-sky-800/40 bg-[#101a2c]">
      <div className="flex items-center justify-between gap-3 border-b border-sky-800/30 px-4 py-3">
        <h3 className="text-sm font-bold text-white">Manual releases ({items.length})</h3>
        <button type="button" onClick={() => void load()} disabled={loading || saving || Boolean(deleting)} className="rounded-md border border-sky-700/40 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-600/10">Refresh</button>
      </div>
      {loading ? <p className="p-4 text-xs text-slate-400">Loading releases…</p> :
        items.length === 0 ? <p className="p-4 text-xs leading-relaxed text-slate-400">No manual releases yet. Add one above. AniList data is automatic and does not need to be added manually.</p> :
        <div className="max-h-[540px] divide-y divide-sky-700/20 overflow-y-auto">
          {[...items].sort((a, b) => a.airingAt.localeCompare(b.airingAt)).map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-bold text-white sm:text-sm">{item.title}</p>
                <p className="mt-1 text-[11px] text-slate-400">{new Date(item.airingAt).toLocaleString()} · {item.kind}{item.episode ? " · Episode " + item.episode : ""}</p>
                {item.anilistId && <p className="mt-1 text-[10px] text-sky-300">AniList ID {item.anilistId}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => edit(item)} disabled={saving || Boolean(deleting)} className="rounded-lg border border-sky-700/40 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-700/20">Edit</button>
                <button type="button" onClick={() => void remove(item)} disabled={saving || Boolean(deleting)} aria-label={"Delete calendar release " + item.title} className="rounded-lg border border-rose-700/40 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-800/20">{deleting === item.id ? "Deleting…" : "Delete"}</button>
              </div>
            </div>
          ))}
        </div>}
    </div>
  </section>;
}
