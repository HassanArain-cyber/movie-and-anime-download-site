import Link from "next/link";
import PosterImage from "./PosterImage";
import type { Media } from "@/lib/types";

export default function MediaCard({ item }: { item: Media }) {
  const typeLabel =
    item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "Series";

  return (
    <Link
      href={`/${item.type}/${item.slug}`}
      className="vault-card group block min-w-0"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
        <PosterImage src={item.posterUrl} title={item.title}
          sizes="(max-width: 480px) 46vw, (max-width: 768px) 30vw, (max-width: 1024px) 23vw, 190px"
          className="object-contain transition duration-300 group-hover:scale-[1.03]" />
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
          {typeLabel}
        </span>
        {item.year && (
          <span className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs text-neutral-300 backdrop-blur">
            {item.year}
          </span>
        )}
      </div>
      <div className="px-0.5 pb-2 pt-3">
        <h3 className="line-clamp-2 text-sm font-semibold text-white group-hover:text-purple-300">
          {item.title}
        </h3>
        {item.categoryName && (
          <p className="mt-0.5 text-xs text-neutral-400">{item.categoryName}</p>
        )}
      </div>
    </Link>
  );
}
