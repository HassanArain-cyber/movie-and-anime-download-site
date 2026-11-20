export default function Loading() {
  return (
    <div className="animate-pulse space-y-8" role="status" aria-label="Loading library">
      <div className="h-8 w-52 rounded-lg bg-neutral-800" />
      <div className="flex flex-wrap gap-3">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-9 w-24 rounded-full bg-neutral-800/80" />)}
      </div>
      <div className="vault-poster-grid grid gap-4">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="space-y-3" aria-hidden="true">
            <div className="aspect-[2/3] rounded-xl bg-neutral-800/70" />
            <div className="h-4 w-4/5 rounded bg-neutral-800" />
            <div className="h-3 w-1/2 rounded bg-neutral-800/60" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading titles…</span>
    </div>
  );
}
