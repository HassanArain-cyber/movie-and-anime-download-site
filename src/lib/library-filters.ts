export const LIBRARY_SORT_OPTIONS = ["az", "za", "newest", "oldest"] as const;
export type LibrarySort = typeof LIBRARY_SORT_OPTIONS[number];

export function isLibrarySort(value: string | null | undefined): value is LibrarySort {
  return LIBRARY_SORT_OPTIONS.some((option) => option === value);
}

export function sortMediaItems<T extends { title: string; createdAt: Date | string | null }>(items: T[], sort: LibrarySort): T[] {
  return [...items].sort((left, right) => {
    if (sort === "az" || sort === "za") {
      const byTitle = left.title.localeCompare(right.title, undefined, { sensitivity: "base", numeric: true });
      return (sort === "az" ? byTitle : -byTitle) || byNewest(left, right);
    }
    return sort === "newest" ? byNewest(left, right) : byNewest(right, left);
  });
}

function byNewest(left: { createdAt: Date | string | null }, right: { createdAt: Date | string | null }): number {
  const time = (value: Date | string | null) => value == null ? 0 : new Date(value).getTime();
  return time(right.createdAt) - time(left.createdAt);
}
