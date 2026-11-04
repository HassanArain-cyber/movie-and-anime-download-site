"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCommentTimestamp } from "@/lib/comment-display";
import { buildCommentTree, MAX_INDENT_DEPTH, type ThreadedComment } from "@/lib/comment-thread";

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

type ApiRequest = (path: string, init: RequestInit) => Promise<Record<string, unknown>>;

type ThreadActions = {
  enabled: boolean;
  mediaId: number;
  episodeId?: number;
  replyingTo: number | null;
  reportingId: number | null;
  reportReason: string;
  setReportReason: (value: string) => void;
  reportDetails: string;
  setReportDetails: (value: string) => void;
  onLike: (comment: PublicComment) => void;
  onReplyToggle: (id: number) => void;
  onReplyCancel: () => void;
  onReplyPosted: () => void;
  onReportToggle: (id: number) => void;
  onReportSubmit: (id: number) => void;
  apiRequest: ApiRequest;
};

const controlClass = "w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-700";
const iconClass = "h-4 w-4 shrink-0";
const actionButtonClass = "inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border border-neutral-800 px-2.5 py-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-600";

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

  const composerId = `comment-body-${mediaId}-${episodeId ?? "title"}`;
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

  const apiRequest: ApiRequest = async (path, init) => {
    const response = await fetch(path, { ...init, credentials: "same-origin", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error((data as { error?: string } | null)?.error || "Request could not be completed.");
    return (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  };

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await apiRequest("/api/comments", {
        method: "POST",
        body: JSON.stringify({ mediaId, ...(episodeId !== undefined ? { episodeId } : {}), body: draft, isSpoiler, website: honeypot }),
      });
      setDraft("");
      setIsSpoiler(false);
      setHoneypot("");
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

  const tree = useMemo(() => buildCommentTree(items), [items]);
  const actions: ThreadActions = {
    enabled,
    mediaId,
    episodeId,
    replyingTo,
    reportingId,
    reportReason,
    setReportReason,
    reportDetails,
    setReportDetails,
    onLike: (comment) => { void toggleLike(comment); },
    onReplyToggle: (id) => { setReplyingTo((current) => current === id ? null : id); setError(""); setNotice(""); },
    onReplyCancel: () => setReplyingTo(null),
    onReplyPosted: () => { setReplyingTo(null); setNotice("Reply posted."); void load(); },
    onReportToggle: (id) => { setReportingId((current) => current === id ? null : id); setReportDetails(""); setError(""); },
    onReportSubmit: (id) => { void submitReport(id); },
    apiRequest,
  };

  return (
    <section className="vault-comments min-w-0 space-y-5 rounded-2xl border border-white/10 bg-neutral-950/70 p-4 sm:p-6" aria-label={episodeId === undefined ? "Title comments" : "Episode comments"}>
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
        Keep discussion respectful and on-topic. No harassment, spam, illegal links, or personal information. Mark spoilers and report concerns. You can reply to any comment or reply.
      </p>

      {error && <p role="alert" className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}

      {loading ? (
        <p role="status" className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-500">Loading comments…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-800 p-5 text-center text-sm text-neutral-500">No comments yet. Start a respectful discussion.</p>
      ) : (
        <div className="min-w-0 space-y-3">
          {tree.map((node) => <CommentNode key={node.id} node={node} actions={actions} />)}
        </div>
      )}

      {enabled ? (
        <form onSubmit={submitComment} className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
          <label htmlFor={composerId} className="sr-only">Write a comment</label>
          <textarea
            id={composerId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            minLength={2}
            rows={3}
            required
            placeholder="Share a respectful comment…"
            className={controlClass}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-10 items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={isSpoiler} onChange={(event) => setIsSpoiler(event.target.checked)} className="h-4 w-4 accent-violet-500" />
              Contains spoilers
            </label>
            <span className="text-xs text-neutral-600">{draft.length}/2000</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="submit" disabled={submitting || draft.trim().length < 2} className="min-h-11 rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? "Posting…" : "Post comment"}
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

function CommentNode({ node, actions }: { node: ThreadedComment<PublicComment>; actions: ThreadActions }) {
  // Horizontal padding lives on the content wrapper, not the article itself.
  // Otherwise every extra nesting level would compound padding on both sides
  // and eventually squeeze deep replies off a mobile screen. The replies
  // container adds one bounded indent per level until MAX_INDENT_DEPTH.
  const indentClass = node.depth < MAX_INDENT_DEPTH
    ? "ml-3 sm:ml-4 border-l-2 border-neutral-800 pl-2 sm:pl-4"
    : "ml-0 border-l-0 pl-0";
  return (
    <article
      data-testid="comment-node"
      data-comment-id={node.id}
      data-parent-id={node.parentId ?? ""}
      data-depth={node.depth}
      className={`min-w-0 ${node.depth === 0 ? "rounded-lg border border-neutral-800 bg-neutral-900/60" : "rounded-md bg-neutral-950/70"}`}
    >
      <div className={`min-w-0 px-3 py-3 ${node.depth === 0 ? "sm:px-4" : ""}`}>
        {node.depth > MAX_INDENT_DEPTH && <p className="mb-2 text-[11px] text-neutral-500">Reply · level {node.depth}</p>}
        <CommentBody comment={node} />
        <div data-actions-for={node.id} data-testid="comment-action-bar" className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <time data-testid="comment-metadata" dateTime={node.createdAt} className="min-w-0 text-[11px] text-neutral-500">
            {formatCommentTimestamp(node.createdAt)}
          </time>
          <button
            type="button"
            data-action="like"
            onClick={() => actions.onLike(node)}
            aria-pressed={node.likedByMe}
            aria-label={node.likedByMe ? `Unlike this comment, ${node.likeCount} ${node.likeCount === 1 ? "like" : "likes"}` : `Like this comment, ${node.likeCount} ${node.likeCount === 1 ? "like" : "likes"}`}
            title={node.likedByMe ? "Remove your like" : "Like this comment"}
            className={`${actionButtonClass} aria-pressed:border-purple-500/60 aria-pressed:text-purple-300`}
          >
            <ThumbsUpIcon />
            <span className="tabular-nums">{node.likeCount}</span>
          </button>
          {actions.enabled && (
            <button
              type="button"
              data-action="reply"
              onClick={() => actions.onReplyToggle(node.id)}
              aria-label={`Reply to comment ${node.id}`}
              title="Reply to this comment"
              className={actionButtonClass}
            >
              <ReplyIcon />
            </button>
          )}
          <button
            type="button"
            data-action="report"
            onClick={() => actions.onReportToggle(node.id)}
            aria-label={`Report comment ${node.id}`}
            title="Report this comment"
            className={actionButtonClass}
          >
            <FlagIcon />
          </button>
        </div>
        {actions.reportingId === node.id && <ReportForm commentId={node.id} actions={actions} />}
        {actions.enabled && actions.replyingTo === node.id && <ReplyComposer parentId={node.id} depth={node.depth} inputId={`reply-body-${actions.mediaId}-${actions.episodeId ?? "title"}-${node.id}`} actions={actions} />}
      </div>
      {node.replies.length > 0 && (
        <div className={`mt-3 min-w-0 space-y-3 ${indentClass}`} aria-label="Replies">
          {node.replies.map((reply) => <CommentNode key={reply.id} node={reply} actions={actions} />)}
        </div>
      )}
    </article>
  );
}

function ReportForm({ commentId, actions }: { commentId: number; actions: ThreadActions }) {
  return (
    <div className="mt-3 space-y-2 rounded-md border border-neutral-800 bg-neutral-950 p-3">
      <label className="block text-xs text-neutral-400">Report reason
        <select value={actions.reportReason} onChange={(event) => actions.setReportReason(event.target.value)} className={`${controlClass} mt-1`}>
          <option value="spam">Spam or unwanted promotion</option>
          <option value="harassment">Harassment or abuse</option>
          <option value="spoiler">Unmarked spoiler</option>
          <option value="other">Other concern</option>
        </select>
      </label>
      <textarea value={actions.reportDetails} onChange={(event) => actions.setReportDetails(event.target.value)} maxLength={500} rows={2} placeholder="Optional details (max 500 characters)" className={controlClass} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => actions.onReportSubmit(commentId)} className="min-h-10 rounded-md border border-red-900/50 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40">Send report</button>
        <button type="button" onClick={() => actions.onReportToggle(commentId)} className="min-h-10 rounded-md px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800">Cancel</button>
      </div>
    </div>
  );
}

function ReplyComposer({ parentId, depth, inputId, actions }: { parentId: number; depth: number; inputId: string; actions: ThreadActions }) {
  const [draft, setDraft] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setReplyError("");
    setSubmitting(true);
    try {
      await actions.apiRequest("/api/comments", {
        method: "POST",
        body: JSON.stringify({
          mediaId: actions.mediaId,
          ...(actions.episodeId !== undefined ? { episodeId: actions.episodeId } : {}),
          parentId,
          body: draft,
          isSpoiler,
          website: honeypot,
        }),
      });
      actions.onReplyPosted();
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : "Could not post reply.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 rounded-md border border-neutral-700 bg-neutral-950 p-3">
      <p className="text-xs text-neutral-400">Replying to this comment · new reply at level {depth + 1}</p>
      <label htmlFor={inputId} className="sr-only">Write a reply to comment {parentId}</label>
      <textarea
        id={inputId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={2000}
        minLength={2}
        rows={2}
        required
        placeholder="Write your reply…"
        className={controlClass}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-9 items-center gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={isSpoiler} onChange={(event) => setIsSpoiler(event.target.checked)} className="h-4 w-4 accent-violet-500" />
          Contains spoilers
        </label>
        <span className="text-xs text-neutral-600">{draft.length}/2000</span>
      </div>
      {replyError && <p role="alert" className="text-xs text-red-300">{replyError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={submitting || draft.trim().length < 2} className="min-h-10 rounded-md bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? "Posting…" : "Post reply"}
        </button>
        <button type="button" onClick={actions.onReplyCancel} className="min-h-10 rounded-md px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800">Cancel</button>
      </div>
      <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">Website<input name="website" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} autoComplete="off" tabIndex={-1} /></label>
    </form>
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
    <div className="min-w-0">
      {comment.isSpoiler && <span className="mb-2 inline-block rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">Spoiler shown</span>}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-200">{comment.body}</p>
    </div>
  );
}

/** Shared 16px outline icons keep every action button the same size and alignment. */
function ThumbsUpIcon() {
  return (
    <svg data-icon="thumbs-up" className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3Z" />
      <path d="M7 10l4.3-7.2a2 2 0 0 1 3.7 1.5L13.8 8H19a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 17.8 18H7" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg data-icon="reply" className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
      <path d="m11 8-3 3 3 3" />
      <path d="M8 11h6" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg data-icon="flag" className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </svg>
  );
}
