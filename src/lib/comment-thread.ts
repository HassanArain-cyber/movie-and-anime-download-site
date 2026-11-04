/**
 * Pure helpers for turning a flat list of comments into a nested forest.
 *
 * The database already stores arbitrary depth in `comments.parent_id` (a
 * self-referencing foreign key). No depth column or migration is needed: the
 * depth used for indentation is derived from the parent chain here.
 */

export type ThreadableComment = { id: number; parentId: number | null };

export type ThreadedComment<T extends ThreadableComment> = T & {
  /** 0 for a root comment, 1 for a direct reply, and so on. */
  depth: number;
  replies: ThreadedComment<T>[];
};

/**
 * Beyond this depth the UI stops adding indentation so very deep threads stay
 * readable on narrow screens. Nesting itself is unbounded; deeper comments
 * simply keep the same visual indent and show their level in a badge.
 */
export const MAX_INDENT_DEPTH = 6;

/**
 * Build a forest from flat API rows. There is no depth limit. Missing parents,
 * self-references, and malformed cycles are surfaced as roots rather than being
 * dropped or recursed into forever, so unexpected legacy data cannot hang the
 * browser.
 */
export function buildCommentTree<T extends ThreadableComment>(items: readonly T[]): ThreadedComment<T>[] {
  const nodes = new Map<number, ThreadedComment<T>>();
  for (const item of items) {
    if (!nodes.has(item.id)) nodes.set(item.id, { ...item, depth: 0, replies: [] });
  }
  const ordered = [...nodes.values()];
  const parentById = new Map<number, number | null>(ordered.map((node) => [node.id, node.parentId]));

  const createsCycle = (id: number, parentId: number): boolean => {
    let current: number | null = parentId;
    const seen = new Set<number>();
    while (current !== null && parentById.has(current)) {
      if (current === id || seen.has(current)) return true;
      seen.add(current);
      current = parentById.get(current) ?? null;
    }
    return false;
  };

  const roots: ThreadedComment<T>[] = [];
  for (const node of ordered) {
    const parentId = node.parentId;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parentId !== null && parent && !createsCycle(node.id, parentId)) parent.replies.push(node);
    else roots.push(node);
  }

  // Iterative traversal avoids call-stack limits on extremely deep threads.
  const stack = roots.map((node) => ({ node, depth: 0 }));
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    node.depth = depth;
    for (const child of [...node.replies].reverse()) stack.push({ node: child, depth: depth + 1 });
  }
  return roots;
}

/**
 * Depth of each comment without changing the flat order. Useful for moderation
 * lists that remain sorted by creation time but still need to show reply level.
 */
export function commentDepths(items: readonly ThreadableComment[]): Map<number, number> {
  const parentById = new Map<number, number | null>();
  for (const item of items) parentById.set(item.id, item.parentId);
  const depths = new Map<number, number>();
  for (const item of items) {
    let depth = 0;
    let current = item.parentId;
    const seen = new Set<number>([item.id]);
    while (current !== null && parentById.has(current) && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parentById.get(current) ?? null;
    }
    depths.set(item.id, depth);
  }
  return depths;
}
