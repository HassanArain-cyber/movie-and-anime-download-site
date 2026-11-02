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
    setError("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSent(false);
    setError("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, company }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "We couldn’t send your request. Please try again.");
      }
      setSent(true);
      setDraft({ name: "", type: "Movie", message: "" });
      setCompany("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn’t send your request. Please try again.");
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
        className="shrink-0 rounded-md border border-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-300 hover:border-neutral-700 hover:text-white"
      >
        Request
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/80 p-4 sm:p-6"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !submittingRef.current) setOpen(false); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="request-title" className="text-lg font-semibold text-white">Send a request</h2>
                <p className="mt-1 text-sm text-neutral-400">Tell us what you would like added to Vault.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} aria-label="Close request form" className="shrink-0 rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-50">✕</button>
            </div>
            <form className="space-y-3" onSubmit={submit}>
              <label className="block space-y-1 text-sm text-neutral-300">Name
                <input required maxLength={100} value={draft.name} onChange={(event) => update({ name: event.target.value })} className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600" />
              </label>
              <label className="block space-y-1 text-sm text-neutral-300">Request Type
                <select value={draft.type} onChange={(event) => update({ type: event.target.value as ContactRequestType })} className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600">
                  {CONTACT_REQUEST_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm text-neutral-300">Message
                <textarea required maxLength={2000} rows={4} value={draft.message} onChange={(event) => update({ message: event.target.value })} className="mt-1 w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600" />
              </label>
              <div aria-hidden="true" className="absolute h-px w-px overflow-hidden" style={{ left: "-10000px" }}>
                <label>Company website
                  <input tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} />
                </label>
              </div>
              <button type="submit" disabled={submitting} className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-wait disabled:opacity-60">
                {submitting ? "Sending…" : "Submit"}
              </button>
            </form>
            {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
            {sent && <p role="status" className="mt-4 text-sm text-emerald-300">Your request was sent to the site admin. Thank you!</p>}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
