import test from "node:test";
import assert from "node:assert/strict";
import { buildCommentTree, commentDepths, MAX_INDENT_DEPTH, type ThreadedComment } from "../src/lib/comment-thread";

type Row = { id: number; parentId: number | null; body: string };

function flatten(nodes: ThreadedComment<Row>[]): ThreadedComment<Row>[] {
  const result: ThreadedComment<Row>[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (const child of [...node.replies].reverse()) stack.push(child);
  }
  return result;
}

test("comment threads nest to arbitrary depth with correct parent links and depth values", () => {
  const rows: Row[] = [{ id: 1, parentId: null, body: "root" }];
  for (let level = 1; level <= 12; level++) rows.push({ id: level + 1, parentId: level, body: `level ${level}` });
  // A second branch off level 3 proves siblings and deep sub-branches work too.
  rows.push({ id: 100, parentId: 4, body: "branch level 4" });
  for (let level = 5; level <= 10; level++) rows.push({ id: 100 + level - 4, parentId: 100 + level - 5, body: `branch level ${level}` });

  const tree = buildCommentTree(rows);
  assert.equal(tree.length, 1, "one root comment");
  const all = flatten(tree);
  assert.equal(all.length, rows.length, "every comment is rendered exactly once");
  assert.equal(new Set(all.map((node) => node.id)).size, rows.length);
  assert.equal(tree[0].depth, 0);
  assert.equal(tree[0].replies[0].depth, 1);
  assert.equal(tree[0].replies[0].replies[0].depth, 2);
  const deepest = all.find((node) => node.id === 13)!;
  assert.equal(deepest.depth, 12, "a 12-level reply chain is preserved");
  const branchDeepest = all.find((node) => node.id === 106)!;
  assert.equal(branchDeepest.depth, 10);
  assert.equal(all.find((node) => node.id === 100)!.parentId, 4);
  for (const node of all) {
    if (node.parentId === null) continue;
    const parent = all.find((candidate) => candidate.id === node.parentId)!;
    assert.ok(parent.replies.some((child) => child.id === node.id), `comment ${node.id} is a child of ${parent.id}`);
  }
});

test("nesting is unbounded even past the UI indentation cap", () => {
  const rows: Row[] = [{ id: 1, parentId: null, body: "root" }];
  for (let level = 1; level < 40; level++) rows.push({ id: level + 1, parentId: level, body: `level ${level}` });
  const tree = buildCommentTree(rows);
  const deepest = flatten(tree).at(-1)!;
  assert.equal(deepest.depth, 39);
  assert.ok(deepest.depth > MAX_INDENT_DEPTH, "display indentation is capped, data nesting is not");
});

test("missing parents and malformed cycles cannot drop comments or recurse forever", () => {
  const rows: Row[] = [
    { id: 1, parentId: null, body: "root" },
    { id: 2, parentId: 999, body: "orphan" },
    { id: 3, parentId: 3, body: "self" },
    { id: 4, parentId: 5, body: "cycle a" },
    { id: 5, parentId: 4, body: "cycle b" },
    { id: 6, parentId: 1, body: "child" },
  ];
  const tree = buildCommentTree(rows);
  const all = flatten(tree);
  assert.deepEqual([...new Set(all.map((node) => node.id))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(all.length, rows.length, "no node is duplicated by a cycle");
  assert.equal(all.find((node) => node.id === 6)!.depth, 1);
});

test("flat moderation lists still report reply depth and terminate on cycles", () => {
  const rows = [{ id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 3 }, { id: 5, parentId: 5 }, { id: 6, parentId: 7 }, { id: 7, parentId: 6 }];
  const depths = commentDepths(rows);
  assert.equal(depths.get(1), 0);
  assert.equal(depths.get(2), 1);
  assert.equal(depths.get(3), 2);
  assert.equal(depths.get(4), 3);
  assert.ok(Number.isFinite(depths.get(5)));
  assert.ok(Number.isFinite(depths.get(6)));
  assert.ok(Number.isFinite(depths.get(7)));
});
