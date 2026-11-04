import MediaCard from "./MediaCard";
import type { Media } from "@/lib/types";

export default function MediaGrid({ items }: { items: Media[] }) {
  if (!items.length) return null;
  return (
    <div className="vault-poster-grid vault-editorial-grid grid">
      {items.map((item, index) => (
        <MediaCard key={item.id} item={item} featured={index === 0 && items.length >= 5} />
      ))}
    </div>
  );
}
