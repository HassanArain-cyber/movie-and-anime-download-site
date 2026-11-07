"use client";

import { useCallback, useEffect, useState } from "react";
import type { Category } from "@/lib/types";

export default function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load categories");
      setCategories(Array.isArray(data) ? data : []);
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed to load"); }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/categories").then((res) => res.json()).then((data) => { if (active && Array.isArray(data)) setCategories(data); }).catch(() => { if (active) setErr("Failed to load categories"); });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setErr("");
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(editingId ? `/api/categories/${editingId}` : "/api/categories", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setName(""); setEditingId(null); await load();
    } catch (error) { setErr(error instanceof Error ? error.message : "Failed"); }
    finally { setLoading(false); }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this category? Media items will be kept but their category will be unset.")) return;
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) { const data = await res.json(); setErr(data.error || "Delete failed"); return; }
    await load();
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder={editingId ? "Edit category name" : "New category name"} className="min-w-0 flex-1 basis-40 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700" />
        <button type="submit" disabled={loading} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">{editingId ? "Update" : "Add category"}</button>
        {editingId && <button type="button" onClick={() => { setEditingId(null); setName(""); }} className="rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-400 hover:text-white">Cancel</button>}
      </form>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      <div className="divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
        {categories.length === 0 ? <p className="p-4 text-sm text-neutral-500">No categories yet.</p> : categories.map((category) => (
          <div key={category.id} className="flex items-center justify-between bg-neutral-900/40 px-4 py-3">
            <div><p className="font-medium text-white">{category.name}</p><p className="text-xs text-neutral-500">/{category.slug}</p></div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEditingId(category.id); setName(category.name); }} className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:text-white">Edit</button>
              <button type="button" onClick={() => void del(category.id)} className="rounded-md border border-red-900/40 px-2 py-1 text-xs text-red-400 hover:bg-red-900/20">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
