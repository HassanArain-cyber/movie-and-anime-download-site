import Link from "next/link";
import Image from "next/image";
import type { Media } from "@/lib/types";
import { placeholderPoster } from "@/lib/utils";

export default function MediaCard({ item }: { item: Media }) {
  const typeLabel =
    item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "Series";

  return (
    <Link
      href={`/${item.type}/${item.slug}`}
      className="group block overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-neutral-800 transition hover:ring-neutral-700"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-neutral-900">
        {item.posterUrl ? (
          <Image
            src={item.posterUrl}
            alt={item.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover transition group-hover:scale-105"
            unoptimized={item.posterUrl.startsWith("data:") || item.posterUrl.startsWith("http")}
          />
        ) : (
          <Image
            src={placeholderPoster(item.title)}
            alt={item.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover"
          />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
          {typeLabel}
        </span>
        {item.year && (
          <span className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs text-neutral-300 backdrop-blur">
            {item.year}
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-white group-hover:text-red-400">
          {item.title}
        </h3>
        {item.categoryName && (
          <p className="mt-0.5 text-xs text-neutral-500">{item.categoryName}</p>
        )}
      </div>
    </Link>
  );
}
