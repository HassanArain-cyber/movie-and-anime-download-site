import MediaCard from "./MediaCard";
import type { Media } from "@/lib/types";

export default function MediaGrid({ items }: { items: Media[] }) {
  if (!items.length) return null;
  return (
    <div className="vault-poster-grid grid">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} />
      ))}
    </div>
  );
}
