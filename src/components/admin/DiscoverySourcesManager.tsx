"use client";
import { useState } from "react";

type Episode = { provider: "AnimeSalt" | "RareAnimes" | "Other"; season: number; episode: number; title: string; url: string };
type Override = { title?: string; posterUrl?: string; description?: string; seriesUrl?: string; episodes: Episode[] };
const blank: Override = { episodes: [] };
export default function DiscoverySourcesManager() {
  const [id, setId] = useState("");
  const [data, setData] = useState<Override>(blank);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!/^\d+$/.test(id)) { setMessage("Enter the numeric AniList ID from /discover/ID"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/discovery-sources?id=${id}`);
      if (!response.ok) throw Error("Could not load");
      const result = await response.json();
      setData(result.override ?? blank);
      setMessage("Loaded. Manual edits are kept separate from AniList metadata.");
    } catch { setMessage("Could not load source details"); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/discovery-sources", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(id), override: data }) });
      if (!response.ok) throw Error("Invalid source details");
      setMessage("Saved. Refresh the Discover detail page to view changes.");
    } catch { setMessage("Save failed. Check HTTPS links and episode numbers."); }
    finally { setBusy(false); }
  };
  const field = (label: string, value: string, change: (s: string) => void) => <label className="block space-y-1 text-xs text-neutral-300"><span>{label}</span><input className="w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-white" value={value} onChange={e => change(e.target.value)} /></label>;
  return <section className="space-y-4 rounded-xl border border-neutral-800 p-4">
    <h2 className="text-lg font-semibold">Discover anime · External sources</h2>
    <p className="text-sm text-neutral-400">Edit a discovered title and add individual episode links from AnimeSalt or RareAnimes. Only verified HTTPS source URLs should be entered. Existing manual media is unaffected.</p>
    <div className="flex gap-2"><input aria-label="AniList anime ID" placeholder="AniList ID (from /discover/ID)" value={id} onChange={e => setId(e.target.value)} className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 p-2" /><button type="button" onClick={load} disabled={busy} className="rounded bg-neutral-800 px-4">Load</button></div>
    {field("Custom title", data.title ?? "", v => setData(d => ({...d,title:v})))}
    {field("Poster HTTPS URL", data.posterUrl ?? "", v => setData(d => ({...d,posterUrl:v})))}
    <label className="block space-y-1 text-xs text-neutral-300"><span>Description</span><textarea className="w-full rounded border border-neutral-700 bg-neutral-950 p-2" value={data.description ?? ""} onChange={e => setData(d => ({...d,description:e.target.value}))} /></label>
    {field("Series / seasons source HTTPS URL", data.seriesUrl ?? "", v => setData(d => ({...d,seriesUrl:v})))}
    <h3 className="font-medium">Episode Watch / Download source pages</h3>
    {data.episodes.map((ep,i) => <div key={i} className="grid gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-2">
      <select aria-label="Provider" value={ep.provider} onChange={e=>setData(d=>({...d,episodes:d.episodes.map((x,j)=>j===i?{...x,provider:e.target.value as Episode["provider"]}:x)}))} className="rounded bg-neutral-900 p-2">{["AnimeSalt","RareAnimes","Other"].map(x=><option key={x}>{x}</option>)}</select>
      {field("Season",String(ep.season),v=>setData(d=>({...d,episodes:d.episodes.map((x,j)=>j===i?{...x,season:Number(v)}:x)})))}
      {field("Episode",String(ep.episode),v=>setData(d=>({...d,episodes:d.episodes.map((x,j)=>j===i?{...x,episode:Number(v)}:x)})))}
      {field("Episode title",ep.title,v=>setData(d=>({...d,episodes:d.episodes.map((x,j)=>j===i?{...x,title:v}:x)})))}
      <div className="sm:col-span-2">{field("Original episode page HTTPS URL",ep.url,v=>setData(d=>({...d,episodes:d.episodes.map((x,j)=>j===i?{...x,url:v}:x)})))}</div>
      <button type="button" onClick={()=>setData(d=>({...d,episodes:d.episodes.filter((_,j)=>j!==i)}))} className="rounded border border-red-700 px-3 py-2 text-sm">Remove episode link</button>
    </div>)}
    <button type="button" onClick={()=>setData(d=>({...d,episodes:[...d.episodes,{provider:"AnimeSalt",season:1,episode:1,title:"",url:""}]}))} className="rounded border border-violet-500 px-3 py-2 text-sm">+ Add episode link</button>
    <button type="button" onClick={save} disabled={busy || !/^\d+$/.test(id)} className="ml-2 rounded bg-violet-600 px-4 py-2 text-sm">Save source details</button>
    <p role="status" className="text-sm text-neutral-400">{message}</p>
  </section>;
}
