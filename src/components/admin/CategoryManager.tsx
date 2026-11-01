"use client";

import { useEffect, useState } from "react";
import type { Category } from "@/lib/types";

export default function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const res = await fetch("/api/categories");
    setCategories(await res.json());
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!name.trim()) return;
    setLoading(true);
    try {
      const url = editingId ? `/api/categories/${editingId}` : "/api/categories";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      setName("");
      setEditingId(null);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this category? Media items will keep their category but it will be unset.")) return;
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    await load();
  };

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setName(c.name);
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={submit}
        className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4 sm:flex-row"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={editingId ? "Edit category name" : "New category name"}
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {editingId ? "Update" : "Add Category"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setName("");
            }}
            className="rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-400 hover:text-white"
          >
            Cancel
          </button>
        )}
      </form>
      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
        {categories.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">No categories yet.</p>
        ) : (
          categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between bg-neutral-900/40 px-4 py-3"
            >
              <div>
                <p className="font-medium text-white">{c.name}</p>
                <p className="text-xs text-neutral-500">/{c.slug}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(c)}
                  className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:text-white"
                >
                  Edit
                </button>
                <button
                  onClick={() => del(c.id)}
                  className="rounded-md border border-red-900/40 px-2 py-1 text-xs text-red-400 hover:bg-red-900/20"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
