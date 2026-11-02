"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { buildRequestLinks, type ContactRequest, type RequestType } from "@/lib/request-links";

const REQUEST_TYPES: RequestType[] = ["Movie", "Anime", "Episode", "Other"];

export default function RequestContact() {
  const [adminEmail, setAdminEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ContactRequest>({ name: "", type: "Movie", message: "" });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/contact/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { adminEmail?: unknown } | null) => {
        if (active && typeof data?.adminEmail === "string") setAdminEmail(data.adminEmail.trim());
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const links = buildRequestLinks(draft, adminEmail);

  const update = (patch: Partial<ContactRequest>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setReady(false);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.message.trim()) return;
    setReady(true);
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
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
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
              <button type="button" onClick={() => setOpen(false)} aria-label="Close request form" className="shrink-0 rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white">✕</button>
            </div>
            <form className="space-y-3" onSubmit={submit}>
              <label className="block space-y-1 text-sm text-neutral-300">Name
                <input required maxLength={100} value={draft.name} onChange={(event) => update({ name: event.target.value })} className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600" />
              </label>
              <label className="block space-y-1 text-sm text-neutral-300">Request Type
                <select value={draft.type} onChange={(event) => update({ type: event.target.value as RequestType })} className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600">
                  {REQUEST_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm text-neutral-300">Message
                <textarea required maxLength={2000} rows={4} value={draft.message} onChange={(event) => update({ message: event.target.value })} className="mt-1 w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none focus:border-neutral-600" />
              </label>
              <button type="submit" className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">Prepare request</button>
            </form>
            {ready && <div className="mt-4 space-y-3 rounded-md border border-neutral-800 bg-neutral-900 p-3">
              <p role="status" className="text-sm text-neutral-300">Request details are ready. Choose a channel to open your draft; it has not been sent yet.</p>
              <div className="flex flex-wrap gap-2">
                <a href={links.telegram} target="_blank" rel="noopener noreferrer" className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600">Continue in Telegram</a>
                {links.gmail
                  ? <a href={links.gmail} target="_blank" rel="noopener noreferrer" className="rounded-md border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800">Continue in Gmail</a>
                  : <p className="w-full text-xs text-amber-300">Email requests are not configured. Ask the site admin to set ADMIN_EMAIL.</p>}
              </div>
            </div>}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
