import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
const key = (id: number) => `discovery_source_${id}`;
const safeUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname; }
  catch { return false; }
};
export type SourceEntry = { provider: "AnimeSalt" | "RareAnimes" | "Other"; season: number; episode: number; title: string; url: string };
export type SourceOverride = { title?: string; posterUrl?: string; description?: string; seriesUrl?: string; episodes: SourceEntry[] };

export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid anime ID" }, { status: 400 });
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, key(id))).limit(1);
  let override: SourceOverride | null = null;
  if (row) { try { override = JSON.parse(row.value) as SourceOverride; } catch { /* ignore malformed legacy value */ } }
  return NextResponse.json({ override }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(req: Request) {
  const auth = await requireAdmin(req);
  if (auth !== true) return auth;
  try {
    const data = await req.json() as { id: number; override: SourceOverride };
    const { id, override } = data;
    if (!Number.isSafeInteger(id) || id < 1 || !override || !Array.isArray(override.episodes) || override.episodes.length > 500) throw Error("Invalid data");
    if (override.title && (typeof override.title !== "string" || override.title.length > 255)) throw Error("Invalid title");
    if (override.description && (typeof override.description !== "string" || override.description.length > 10000)) throw Error("Invalid description");
    if (override.posterUrl && !safeUrl(override.posterUrl)) throw Error("Poster must be an HTTPS URL");
    if (override.seriesUrl && !safeUrl(override.seriesUrl)) throw Error("Series must be an HTTPS URL");
    for (const ep of override.episodes) {
      if (!["AnimeSalt", "RareAnimes", "Other"].includes(ep.provider) || !Number.isInteger(ep.season) || ep.season < 1 || ep.season > 999 || !Number.isInteger(ep.episode) || ep.episode < 1 || ep.episode > 9999 || typeof ep.title !== "string" || ep.title.length > 255 || !safeUrl(ep.url)) throw Error("Invalid episode entry");
    }
    await db.insert(siteSettings).values({ key: key(id), value: JSON.stringify(override) }).onConflictDoUpdate({ target: siteSettings.key, set: { value: JSON.stringify(override), updatedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Invalid source details" }, { status: 400 }); }
}
