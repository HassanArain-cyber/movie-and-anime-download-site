"use client";

import { useCallback, useEffect, useState } from "react";

interface ContactRequestRecord {
  id: number;
  name: string;
  requestType: string;
  message: string;
  createdAt: string;
}

export default function ContactRequestsManager() {
  const [requests, setRequests] = useState<ContactRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/contact/requests", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load requests.");
      setRequests(Array.isArray(data) ? data : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const remove = async (request: ContactRequestRecord) => {
    if (!confirm(`Delete the request from ${request.name}? This cannot be undone.`)) return;
    setDeletingId(request.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/contact/requests/${request.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete this request.");
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setNotice("Request deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this request.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="requests-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="requests-heading" className="text-lg font-semibold text-white">Submitted requests</h2>
          <p className="mt-1 text-sm text-neutral-500">Requests are stored privately in the database and visible only to admins.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-50">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {loading ? <p className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-sm text-neutral-500">Loading requests…</p> : requests.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">No requests have been submitted yet.</p>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <article key={request.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-white">{request.name}</h3>
                    <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{request.requestType}</span>
                  </div>
                  <time dateTime={request.createdAt} className="block text-xs text-neutral-500">
                    {new Date(request.createdAt).toLocaleString()}
                  </time>
                </div>
                <button type="button" onClick={() => void remove(request)} disabled={deletingId === request.id} aria-label={`Delete request from ${request.name}`} className="shrink-0 self-start rounded-md border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/50 disabled:cursor-wait disabled:opacity-50">
                  {deletingId === request.id ? "Deleting…" : "Delete"}
                </button>
              </div>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-300">{request.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
