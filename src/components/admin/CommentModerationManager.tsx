"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { commentDepths } from "@/lib/comment-thread";

type ModeratedComment = {
  id: number;
  parentId: number | null;
  body: string;
  isSpoiler: boolean;
  isHidden: boolean;
  createdAt: string;
  reportCount: number;
  mediaId: number;
  mediaTitle: string;
  mediaType: string;
  episodeId: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  seasonNumber: number | null;
};

type Report = {
  id: number;
  commentId: number;
  reason: string;
  details: string | null;
  status: "pending" | "reviewed" | "resolved";
  reportedAt: string;
  commentBody: string;
  isSpoiler: boolean;
  isHidden: boolean;
  commentCreatedAt: string;
  mediaId: number;
  mediaTitle: string;
  mediaType: string;
  episodeId: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  seasonNumber: number | null;
};

export default function CommentModerationManager() {
  const [reports, setReports] = useState<Report[]>([]);
  const [comments, setComments] = useState<ModeratedComment[]>([]);
  const [view, setView] = useState<"reports" | "comments">("reports");
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = view === "comments" ? "view=all" : `status=${encodeURIComponent(status)}`;
      const response = await fetch(`/api/admin/comments?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load moderation data.");
      if (view === "comments") setComments(Array.isArray(data.comments) ? data.comments : []);
      else setReports(Array.isArray(data) ? data : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load moderation data.");
    } finally { setLoading(false); }
  }, [status, view]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const fetchReports = async () => {
      try {
        const query = view === "comments" ? "view=all" : `status=${encodeURIComponent(status)}`;
        const response = await fetch(`/api/admin/comments?${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load moderation data.");
        if (active) {
          if (view === "comments") setComments(Array.isArray(data.comments) ? data.comments : []);
          else setReports(Array.isArray(data) ? data : []);
        }
      } catch (reason) {
        if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load moderation data.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchReports();
    return () => { active = false; controller.abort(); };
  }, [status, view]);

  const updateStatus = async (report: Report, nextStatus: Report["status"]) => {
    setBusyId(report.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/comment-reports/${report.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update report.");
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, status: data.status } : item));
      setNotice("Report status updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update report."); }
    finally { setBusyId(null); }
  };

  const toggleHidden = async (commentId: number, isHidden: boolean, busyKey: number) => {
    setBusyId(busyKey); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/comments/${commentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isHidden: !isHidden }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update comment.");
      setReports((current) => current.map((item) => item.commentId === commentId ? { ...item, isHidden: data.isHidden } : item));
      setComments((current) => current.map((item) => item.id === commentId ? { ...item, isHidden: data.isHidden } : item));
      setNotice(data.isHidden ? "Comment hidden from the public discussion." : "Comment restored to the public discussion.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update comment."); }
    finally { setBusyId(null); }
  };

  const depths = useMemo(() => commentDepths(comments), [comments]);

  const remove = async (commentId: number, busyKey: number) => {
    if (!window.confirm("Delete this comment and its replies/reports? This cannot be undone.")) return;
    setBusyId(busyKey); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/comments/${commentId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete comment.");
      setReports((current) => current.filter((item) => item.commentId !== commentId));
      setComments((current) => current.filter((item) => item.id !== commentId));
      setNotice("Comment deleted.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete comment."); }
    finally { setBusyId(null); }
  };

  return (
    <section className="space-y-4" aria-labelledby="comment-moderation-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="comment-moderation-heading" className="text-lg font-semibold text-white">Comment moderation</h2>
          <p className="mt-1 text-sm text-neutral-500">Review anonymous reports, hide or restore comments, or remove comments and their reply threads.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-neutral-400">View
            <select aria-label="Moderation view" value={view} onChange={(event) => { setView(event.target.value as "reports" | "comments"); setLoading(true); }} className="ml-2 min-h-10 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-white">
              <option value="reports">Reported comments</option><option value="comments">All comments</option>
            </select>
          </label>
          {view === "reports" && <label className="text-xs text-neutral-400">Show
            <select aria-label="Filter reports by status" value={status} onChange={(event) => { setStatus(event.target.value); setLoading(true); }} className="ml-2 min-h-10 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-white">
              <option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option><option value="">All reports</option>
            </select>
          </label>}
          <button type="button" onClick={() => void load()} disabled={loading} className="min-h-10 rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-50">Refresh</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {loading ? <p role="status" className="rounded-lg border border-neutral-800 p-5 text-sm text-neutral-500">Loading {view === "reports" ? "reports" : "comments"}…</p> : view === "reports" ? reports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">No reports in this queue.</p>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <article key={report.id} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-red-500/10 px-2 py-1 text-xs font-medium capitalize text-red-300">{report.reason}</span>
                    <span className="rounded bg-neutral-800 px-2 py-1 text-xs capitalize text-neutral-300">{report.status}</span>
                    {report.isHidden && <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Hidden</span>}
                  </div>
                  <p className="text-xs text-neutral-500">{report.mediaType} · {report.mediaTitle}{report.episodeId ? ` · Season ${report.seasonNumber} Episode ${report.episodeNumber}${report.episodeTitle ? ` — ${report.episodeTitle}` : ""}` : " · Title comment"}</p>
                  <p className="text-xs text-neutral-600">Reported {new Date(report.reportedAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void toggleHidden(report.commentId, report.isHidden, report.id)} disabled={busyId === report.id} className="min-h-10 rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">{report.isHidden ? "Restore" : "Hide"}</button>
                  <button type="button" onClick={() => void remove(report.commentId, report.id)} disabled={busyId === report.id} className="min-h-10 rounded-md border border-red-900/50 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50">Delete</button>
                </div>
              </div>
              <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-neutral-700 bg-neutral-950/70 p-3 text-sm text-neutral-200">{report.commentBody}</blockquote>
              {report.details && <p className="whitespace-pre-wrap break-words text-sm text-neutral-400">Report details: {report.details}</p>}
              <label className="inline-flex items-center gap-2 text-xs text-neutral-400">Report state
                <select aria-label={`Report status for comment ${report.commentId}`} disabled={busyId === report.id} value={report.status} onChange={(event) => void updateStatus(report, event.target.value as Report["status"])} className="min-h-9 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-neutral-200">
                  <option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option>
                </select>
              </label>
            </article>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">No comments to moderate.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <article key={comment.id} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{(depths.get(comment.id) ?? 0) > 0 ? `Reply · level ${depths.get(comment.id)}` : comment.parentId ? "Reply" : "Comment"}</span>
                    <span className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{comment.reportCount} reports</span>
                    {comment.isSpoiler && <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Spoiler</span>}
                    {comment.isHidden && <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Hidden</span>}
                  </div>
                  <p className="text-xs text-neutral-500">{comment.mediaType} · {comment.mediaTitle}{comment.episodeId ? ` · Season ${comment.seasonNumber} Episode ${comment.episodeNumber}${comment.episodeTitle ? ` — ${comment.episodeTitle}` : ""}` : " · Title comment"}</p>
                  <p className="text-xs text-neutral-600">Posted {new Date(comment.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void toggleHidden(comment.id, comment.isHidden, comment.id)} disabled={busyId === comment.id} className="min-h-10 rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">{comment.isHidden ? "Restore" : "Hide"}</button>
                  <button type="button" onClick={() => void remove(comment.id, comment.id)} disabled={busyId === comment.id} className="min-h-10 rounded-md border border-red-900/50 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50">Delete</button>
                </div>
              </div>
              <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-neutral-700 bg-neutral-950/70 p-3 text-sm text-neutral-200">{comment.body}</blockquote>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
