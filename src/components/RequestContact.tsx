"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONTACT_REQUEST_TYPES, type ContactRequest, type ContactRequestType } from "@/lib/contact-request-types";

export default function RequestContact() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ContactRequest>({ name: "", type: "Movie", message: "" });
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [notificationFailed, setNotificationFailed] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const update = (patch: Partial<ContactRequest>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSent(false);
    setNotificationFailed(false);
    setError("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSent(false);
    setNotificationFailed(false);
    setError("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, company }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string; notificationSent?: boolean };
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "We couldn’t save your request. Please try again.");
      }
      setSent(true);
      setNotificationFailed(data.notificationSent === false);
      setDraft({ name: "", type: "Movie", message: "" });
      setCompany("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t save your request. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Request"
        className="shrink-0 rounded-xl border border-purple-400/20 bg-neutral-900/70 px-2.5 py-2 text-xs font-bold text-neutral-100 transition hover:border-purple-400/60 hover:bg-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      >
        Request
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/85 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !submittingRef.current) setOpen(false); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-[470px] overflow-y-auto overscroll-contain rounded-[22px] border border-purple-400/25 bg-[#14101d] shadow-[0_25px_85px_#000000b8] sm:max-h-[calc(100dvh-3rem)]"
          >
            <div className="relative overflow-hidden border-b border-purple-400/10 bg-gradient-to-br from-[#33204d] via-[#22172f] to-[#171222] px-4 pb-4 pt-5 sm:px-5">
              <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-12 h-36 w-36 rounded-full bg-fuchsia-500/20 blur-3xl" />
              <div className="relative flex items-start gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-200/20 bg-violet-500/25 text-purple-100">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 3 3 11l7 3 3 7 8-18Z" /><path d="m10 14 5-5" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[.17em] text-purple-300">Gojo&apos;s Vault</p>
                  <h2 id="request-title" className="mt-0.5 text-xl font-extrabold tracking-tight text-white">Send a request</h2>
                  <p className="mt-1 text-xs leading-relaxed text-purple-100/65">Suggest an anime, movie, series or episode to add.</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} disabled={submitting} aria-label="Close request form" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/20 text-neutral-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:opacity-50">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l14 14M19 5 5 19" /></svg>
                </button>
              </div>
            </div>
            <form className="space-y-3.5 p-4 sm:p-5" onSubmit={submit}>
              <label className="block space-y-1.5 text-xs font-semibold text-neutral-300">Name
                <input required maxLength={100} value={draft.name} onChange={(event) => update({ name: event.target.value })} className="w-full rounded-xl border border-white/10 bg-[#0b0b13] px-3.5 py-3 text-sm text-white outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-400/15" />
              </label>
              <label className="block space-y-1 text-sm text-neutral-300">Request Type
                <select value={draft.type} onChange={(event) => update({ type: event.target.value as ContactRequestType })} className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600">
                  {CONTACT_REQUEST_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm text-neutral-300">Message
                <textarea required maxLength={2000} rows={3} value={draft.message} onChange={(event) => update({ message: event.target.value })} className="w-full resize-y rounded-xl border border-white/10 bg-[#0b0b13] px-3.5 py-3 text-sm leading-relaxed text-white outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-400/15" />
              </label>
              <div aria-hidden="true" className="absolute h-px w-px overflow-hidden" style={{ left: "-10000px" }}>
                <label>Company website
                  <input tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} />
                </label>
              </div>
              <button type="submit" disabled={submitting} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-700 px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_6px_25px_#7c3aed35] transition hover:brightness-110 active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 disabled:cursor-wait disabled:opacity-60">
                {submitting ? "Submitting…" : "Submit"} {!submitting && <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m5 12 5 5L20 7" /></svg>}
              </button>
              <p className="text-center text-[11px] text-neutral-500">Your request goes directly to the Vault admin.</p>
            </form>
            {error && <p role="alert" className="mx-4 mb-4 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-200 sm:mx-5">{error}</p>}
            {sent && (
              <p role="status" className={`mx-4 mb-4 rounded-lg border p-3 text-xs sm:mx-5 ${notificationFailed ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"}`}>
                {notificationFailed
                  ? "Your request was saved, but the email notification could not be sent. The site admin can still review it."
                  : "Your request has been saved and the site admin has been notified. Thank you!"}
              </p>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
