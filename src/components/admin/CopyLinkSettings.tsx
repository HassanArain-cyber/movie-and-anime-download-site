"use client";

import { useEffect, useState } from "react";

const ENDPOINT = "/api/site-settings/copy-website";

/** The saved site-wide website opened after a Copy Link click. Changed or removed only from here. */
export default function CopyLinkSettings() {
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch(ENDPOINT, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load the saved website");
        if (active) { setSaved(data.url); setValue(data.url ?? ""); }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load the saved website"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = async (method: "PUT" | "DELETE") => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(ENDPOINT, { method, headers: { "Content-Type": "application/json" }, ...(method === "PUT" ? { body: JSON.stringify({ url: value }) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the website");
      setSaved(data.url); setValue(data.url ?? "");
      setMessage(data.url ? "Website saved. Copy Link buttons open it after copying." : "Website removed. Copy Link buttons only copy.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the website"); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="copy-website-heading" className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/90 p-4 sm:p-6">
      <div>
        <h2 id="copy-website-heading" className="text-lg font-semibold text-white">Copy Link website</h2>
        <p className="mt-1 text-sm text-neutral-400">After a visitor copies a Copy Link download, this website opens in a new tab, for example your TeraBox downloader. A link can set its own website instead. With none saved, links are only copied.</p>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void update("PUT"); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs text-neutral-400">Website to Open After Copying
          <input type="url" inputMode="url" required value={value} disabled={loading || busy} onChange={(event) => setValue(event.target.value)} placeholder="https://…" maxLength={2048} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-700 disabled:opacity-60" />
        </label>
        <button type="submit" disabled={loading || busy || !value.trim() || value.trim() === saved} className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Saving…" : saved ? "Update website" : "Save website"}</button>
        <button type="button" onClick={() => void update("DELETE")} disabled={loading || busy || !saved} className="min-h-11 rounded-md border border-red-900/60 px-3 text-sm text-red-300 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50">Remove</button>
      </form>
      {saved && <p className="break-all text-xs text-neutral-500">Saved website: {saved}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {message && <p role="status" className="text-sm text-neutral-300">{message}</p>}
    </section>
  );
}
