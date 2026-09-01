import type { DependencyNode } from "@pnpm/deps.inspection.tree-builder";

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
