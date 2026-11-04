import Link from "next/link";
import PosterImage from "./PosterImage";
import type { Media } from "@/lib/types";

export default function MediaCard({ item, featured = false }: { item: Media; featured?: boolean }) {
  const typeLabel =
    item.type === "movie" ? "Movie" : item.type === "anime" ? "Anime" : "Series";

  return (
    <Link
      href={`/${item.type}/${item.slug}`}
      className={`vault-card group block min-w-0 ${featured ? "vault-card-featured" : ""}`}
    >
      <div className="vault-card-poster relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
        <PosterImage src={item.posterUrl} title={item.title}
          sizes={featured ? "(max-width: 767px) 50vw, (max-width: 1024px) 40vw, 410px" : "(max-width: 767px) 33vw, (max-width: 1024px) 20vw, 195px"}
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
      <div className="vault-card-caption px-0.5 pb-2 pt-3">
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
