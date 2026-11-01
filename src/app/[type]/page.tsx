import { notFound } from "next/navigation";
import Link from "next/link";
import MediaGrid from "@/components/MediaGrid";
import { db } from "@/db";

// Render at request time so content updates are reflected immediately
export const dynamic = "force-dynamic";
import { media, categories } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import type { MediaType } from "@/lib/types";

const VALID_TYPES: Record<string, { label: string }> = {
  movie: { label: "Movies" },
  anime: { label: "Anime" },
  series: { label: "TV Series" },
};

interface PageProps {
  params: Promise<{ type: string }>;
}

export async function generateStaticParams() {
  return Object.keys(VALID_TYPES).map((type) => ({ type }));
}

export default async function TypePage({ params }: PageProps) {
  const { type } = await params;
  if (!VALID_TYPES[type]) notFound();

  const items = await db
    .select({
      id: media.id,
      type: media.type,
      title: media.title,
      slug: media.slug,
      description: media.description,
      posterUrl: media.posterUrl,
      thumbnailUrl: media.thumbnailUrl,
      year: media.year,
      categoryId: media.categoryId,
      categoryName: categories.name,
      createdAt: media.createdAt,
    })
    .from(media)
    .leftJoin(categories, eq(media.categoryId, categories.id))
    .where(eq(media.type, type as MediaType))
    .orderBy(desc(media.createdAt));

  const label = VALID_TYPES[type].label;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{label}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {items.length} {items.length === 1 ? "title" : "titles"}
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-neutral-400 hover:text-white"
        >
          ← Back to all
        </Link>
      </div>
      <MediaGrid items={items as any[]} />
      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-800 p-12 text-center text-neutral-500">
          No {label.toLowerCase()} yet.
        </div>
      )}
    </div>
  );
}
