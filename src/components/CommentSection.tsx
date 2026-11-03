"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PublicComment = {
  id: number;
  mediaId: number;
  episodeId: number | null;
  parentId: number | null;
  body: string;
  isSpoiler: boolean;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
};

type Props = {
  mediaId: number;
  episodeId?: number;
  enabled: boolean;
};

const controlClass = "w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-700";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleString();
}

export default function CommentSection({ mediaId, episodeId, enabled }: Props) {
  const [items, setItems] = useState<PublicComment[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [reportingId, setReportingId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState("spam");
  const [reportDetails, setReportDetails] = useState("");

  const url = useMemo(() => {
    const params = new URLSearchParams({ mediaId: String(mediaId) });
    if (episodeId !== undefined) params.set("episodeId", String(episodeId));
    return `/api/comments?${params.toString()}`;
  }, [mediaId, episodeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load comments.");
      setItems(Array.isArray(data.comments) ? data.comments : []);
      setCount(Number(data.count) || 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load comments.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const fetchInitial = async () => {
      try {
        const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load comments.");
        if (active) {
          setItems(Array.isArray(data.comments) ? data.comments : []);
          setCount(Number(data.count) || 0);
        }
      } catch (reason) {
        if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load comments.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchInitial();
    return () => { active = false; controller.abort(); };
  }, [url]);

  const apiRequest = async (path: string, init: RequestInit) => {
    const response = await fetch(path, { ...init, credentials: "same-origin", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request could not be completed.");
    return data;
  };

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await apiRequest("/api/comments", {
        method: "POST",
        body: JSON.stringify({ mediaId, ...(episodeId !== undefined ? { episodeId } : {}), ...(replyingTo ? { parentId: replyingTo } : {}), body: draft, isSpoiler, website: honeypot }),
      });
      setDraft("");
      setIsSpoiler(false);
      setReplyingTo(null);
      setNotice("Comment posted.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not post comment.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLike = async (comment: PublicComment) => {
    setError("");
    try {
      const data = await apiRequest(`/api/comments/${comment.id}/like`, { method: comment.likedByMe ? "DELETE" : "PUT" });
      setItems((current) => current.map((item) => item.id === comment.id ? { ...item, likedByMe: Boolean(data.liked), likeCount: Number(data.likeCount) || 0 } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your like.");
    }
  };

  const submitReport = async (commentId: number) => {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/comments/${commentId}/report`, { method: "POST", body: JSON.stringify({ reason: reportReason, details: reportDetails }) });
      setReportingId(null);
      setReportDetails("");
      setNotice("Report sent to the moderators.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not report this comment.");
    }
  };

  const visibleIds = new Set(items.map((item) => item.id));
  const roots = items.filter((item) => item.parentId === null || !visibleIds.has(item.parentId));
  const replies = new Map<number, PublicComment[]>();
  for (const item of items) {
    if (item.parentId === null || !visibleIds.has(item.parentId)) continue;
    replies.set(item.parentId, [...(replies.get(item.parentId) ?? []), item]);
  }

  return (
    <section className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 sm:p-6" aria-label={episodeId === undefined ? "Title comments" : "Episode comments"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {episodeId === undefined ? "Community comments" : "Episode discussion"} <span className="ml-1 text-sm font-normal text-neutral-500">({count})</span>
          </h2>
          <p className="mt-1 text-xs text-neutral-500">{episodeId === undefined ? "Comments about this title" : "Comments for this episode only"}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="min-h-10 rounded-md border border-neutral-800 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-50">Refresh</button>
      </div>

      <p className="rounded-md bg-neutral-900/70 px-3 py-2 text-xs leading-relaxed text-neutral-500">
        Keep discussion respectful and on-topic. No harassment, spam, illegal links, or personal information. Mark spoilers and report concerns.
      </p>

      {error && <p role="alert" className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}

      {loading ? (
        <p role="status" className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-500">Loading comments…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 p-5 text-center text-sm text-neutral-500">No comments yet. Start a respectful discussion.</p>
      ) : (
        <div className="space-y-3">
          {roots.map((comment) => (
            <article key={comment.id} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 sm:p-4">
              <CommentBody comment={comment} />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-neutral-500">Community member · {formatDate(comment.createdAt)}</span>
                <button type="button" onClick={() => void toggleLike(comment)} aria-pressed={comment.likedByMe} className="min-h-9 rounded-md border border-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 aria-pressed:border-red-900/60 aria-pressed:text-red-300">
                  {comment.likedByMe ? "Liked" : "Like"} · {comment.likeCount}
                </button>
                <button type="button" onClick={() => { setReplyingTo(comment.id); setError(""); }} className="min-h-9 rounded-md px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white">Reply</button>
                <button type="button" onClick={() => { setReportingId(reportingId === comment.id ? null : comment.id); setError(""); }} className="min-h-9 rounded-md px-3 py-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200">Report</button>
              </div>
              {reportingId === comment.id && (
                <div className="mt-3 space-y-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                  <label className="block text-xs text-neutral-400">Report reason
                    <select value={reportReason} onChange={(event) => setReportReason(event.target.value)} className={`${controlClass} mt-1`}>
                      <option value="spam">Spam or unwanted promotion</option>
                      <option value="harassment">Harassment or abuse</option>
                      <option value="spoiler">Unmarked spoiler</option>
                      <option value="other">Other concern</option>
                    </select>
                  </label>
                  <textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={500} rows={2} placeholder="Optional details (max 500 characters)" className={controlClass} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void submitReport(comment.id)} className="min-h-10 rounded-md border border-red-900/50 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40">Send report</button>
                    <button type="button" onClick={() => setReportingId(null)} className="min-h-10 rounded-md px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800">Cancel</button>
                  </div>
                </div>
              )}
              {!!replies.get(comment.id)?.length && (
                <div className="mt-4 space-y-3 border-l-2 border-neutral-800 pl-3 sm:pl-5" aria-label="Replies">
                  {replies.get(comment.id)!.map((reply) => (
                    <article key={reply.id} className="rounded-md bg-neutral-950/70 p-3">
                      <CommentBody comment={reply} />
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <span>Community member · {formatDate(reply.createdAt)}</span>
                        <button type="button" onClick={() => void toggleLike(reply)} aria-pressed={reply.likedByMe} className="min-h-9 rounded-md border border-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800">
                          {reply.likedByMe ? "Liked" : "Like"} · {reply.likeCount}
                        </button>
                        <button type="button" onClick={() => { setReportingId(reportingId === reply.id ? null : reply.id); setError(""); }} className="min-h-9 rounded-md px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-200">Report</button>
                      </div>
                      {reportingId === reply.id && (
                        <div className="mt-3 space-y-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
                          <label className="block text-xs text-neutral-400">Report reason
                            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)} className={`${controlClass} mt-1`}>
                              <option value="spam">Spam or unwanted promotion</option><option value="harassment">Harassment or abuse</option><option value="spoiler">Unmarked spoiler</option><option value="other">Other concern</option>
                            </select>
                          </label>
                          <textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={500} rows={2} placeholder="Optional details (max 500 characters)" className={controlClass} />
                          <div className="flex gap-2"><button type="button" onClick={() => void submitReport(reply.id)} className="min-h-10 rounded-md border border-red-900/50 px-3 py-2 text-xs text-red-300">Send report</button><button type="button" onClick={() => setReportingId(null)} className="min-h-10 rounded-md px-3 py-2 text-xs text-neutral-400">Cancel</button></div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {enabled ? (
        <form onSubmit={submitComment} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
          {replyingTo !== null && (
            <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
              <span>Replying in this thread</span>
              <button type="button" onClick={() => setReplyingTo(null)} className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800">Cancel reply</button>
            </div>
          )}
          <label htmlFor={`comment-body-${mediaId}-${episodeId ?? "title"}`} className="sr-only">Write a comment</label>
          <textarea
            id={`comment-body-${mediaId}-${episodeId ?? "title"}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            minLength={2}
            rows={3}
            required
            placeholder={replyingTo === null ? "Share a respectful comment…" : "Write your reply…"}
            className={controlClass}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-10 items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={isSpoiler} onChange={(event) => setIsSpoiler(event.target.checked)} className="h-4 w-4 accent-red-500" />
              Contains spoilers
            </label>
            <span className="text-xs text-neutral-600">{draft.length}/2000</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="submit" disabled={submitting || draft.trim().length < 2} className="min-h-11 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? "Posting…" : replyingTo === null ? "Post comment" : "Post reply"}
            </button>
            <span className="text-xs text-neutral-600">Comments are anonymous; no name or email is collected.</span>
          </div>
          <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">Website<input name="website" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} autoComplete="off" tabIndex={-1} /></label>
        </form>
      ) : (
        <p className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-sm text-neutral-500">New comments are disabled for this content. Existing comments remain visible.</p>
      )}
    </section>
  );
}

function CommentBody({ comment }: { comment: PublicComment }) {
  const [revealed, setRevealed] = useState(false);
  if (comment.isSpoiler && !revealed) {
    return (
      <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3">
        <span className="mr-2 rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">Spoiler</span>
        <button type="button" onClick={() => setRevealed(true)} className="min-h-9 rounded-md px-3 py-1 text-sm text-amber-200 underline decoration-amber-700 underline-offset-2 hover:text-white">Show Spoiler</button>
      </div>
    );
  }
  return (
    <div>
      {comment.isSpoiler && <span className="mb-2 inline-block rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">Spoiler shown</span>}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-200">{comment.body}</p>
    </div>
  );
}
