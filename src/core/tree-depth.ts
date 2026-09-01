import type { DependencyNode } from "@pnpm/deps.inspection.tree-builder";

/**
 * Pass this, never a finite number, to `computeShallowestDepths` for
 * *detection* purposes (is a package used at all, by which importers) —
 * `dependency-tracker.ts`'s `traverseTreeAndBuildMap` and
 * `duplicates.usecase.ts`'s `collectFromTreeNodes`. Whether something is
 * used shouldn't depend on how deep in the tree it happens to sit, and it's
 * cheap regardless: this function is a BFS bounded by distinct-node count
 * (the tree is already deduped, O(N)), not by depth or path count.
 *
 * The user-facing `--depth` option still does something real — it limits
 * how far a *path search* recurses (`findPathInTree` / `findAllPathsInTree`
 * in `dependency-tracker.ts`, via `Math.min(hard limit, this.depth)`) —
 * because enumerating every path through a wide, heavily-shared graph (not
 * just visiting every node) can still blow up combinatorially within any
 * fixed depth. Detection and path search are answering different
 * questions, so they don't share the same depth limit.
 */
export const UNBOUNDED_TREE_DEPTH = Infinity;

/**
 * Shallowest depth at which each node in a DAG built from `roots` is
 * reachable, capped at `maxDepth` (roots are depth 1). Nodes only reachable
 * beyond `maxDepth` — through every path that reaches them — are absent
 * from the result.
 *
 * Needed because `buildTreesFromPnpm` now builds trees with `depth:
 * Infinity` (see tree-dedup.ts's CALLER CONTRACT for why): the returned
 * tree carries no depth limit of its own, so `--depth` has to be enforced
 * while walking it instead of by the tree-builder library. A plain
 * recursive walk with a per-call depth counter would give each node
 * whichever depth the first path that reaches it happens to use, which
 * depends on traversal/iteration order — not deterministic, and not what
 * `--depth` meant when the library itself enforced it (depth-limit the
 * graph, not a single path through it). BFS from the roots naturally
 * visits every node at its shallowest depth first, since all depth-D nodes
 * are dequeued before any depth-(D+1) node, matching that.
 */
export function computeShallowestDepths(
  roots: DependencyNode[],
  maxDepth: number,
): Map<DependencyNode, number> {
  const depths = new Map<DependencyNode, number>();
  const queue: Array<{ node: DependencyNode; depth: number }> = roots.map(
    (node) => ({ node, depth: 1 }),
  );

  let head = 0;
  while (head < queue.length) {
    const { node, depth } = queue[head++]!;
    if (depth > maxDepth) continue;
    if (depths.has(node)) continue; // already recorded, and BFS guarantees that was <= depth
    depths.set(node, depth);

    if (node.dependencies) {
      for (const child of node.dependencies) {
        queue.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return depths;
}
