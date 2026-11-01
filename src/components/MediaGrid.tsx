import MediaCard from "./MediaCard";
import type { Media } from "@/lib/types";

export default function MediaGrid({ items }: { items: Media[] }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} />
      ))}
    </div>
  );
}
