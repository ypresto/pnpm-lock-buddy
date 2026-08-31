import type {
  DependenciesTree,
  DependencyNode,
} from "@pnpm/deps.inspection.tree-builder";

/**
 * Unique identity key for a DependencyNode within the whole-workspace tree
 * build's materialization cache. `path` alone is not always enough: a
 * workspace `link:` node reached through different peer-dependency contexts
 * can share the same `path` while resolving a different peer variant, which
 * is exactly what `peersSuffixHash` distinguishes.
 */
function nodeIdentityKey(node: DependencyNode): string {
  return `${node.path}::${node.peersSuffixHash ?? ""}`;
}

function collectFullyExpanded(
  nodes: DependencyNode[] | undefined,
  byIdentity: Map<string, DependencyNode>,
): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (!node.deduped && !byIdentity.has(nodeIdentityKey(node))) {
      byIdentity.set(nodeIdentityKey(node), node);
    }
    collectFullyExpanded(node.dependencies, byIdentity);
  }
}

function resolveDeduped(
  nodes: DependencyNode[] | undefined,
  byIdentity: Map<string, DependencyNode>,
  resolvedIdentities: Set<string>,
): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.deduped) {
      const full = byIdentity.get(nodeIdentityKey(node));
      if (full?.dependencies) {
        node.dependencies = full.dependencies;
      }
      continue;
    }

    const key = nodeIdentityKey(node);
    if (resolvedIdentities.has(key)) continue;
    resolvedIdentities.add(key);
    resolveDeduped(node.dependencies, byIdentity, resolvedIdentities);
  }
}

/**
 * @pnpm/deps.inspection.tree-builder bounds a whole-workspace tree build to
 * O(N) nodes by materializing each distinct subtree only once: every later
 * occurrence of the same package+peer-context comes back as a
 * `deduped: true` stub with no `dependencies` of its own (see the library's
 * `MaterializationCache`, documented in its `getTree.d.ts`). Consumers that
 * walk `.dependencies` per node — as this codebase's duplicate-detection and
 * usage-tracking logic does — would otherwise silently treat a deduped stub
 * as a leaf, undercounting real duplicate instances underneath it.
 *
 * Confirmed against a real ~135-project monorepo: 41% of all returned nodes
 * came back deduped, and duplicate detection dropped from 123 to 53 affected
 * projects before this fix.
 *
 * Mutates every tree in `trees` in place, replacing each deduped node's
 * `dependencies` with the fully-expanded subtree found elsewhere in the same
 * result set (a shared array reference, not a copy — nested deduped nodes
 * inside it resolve the same way when that subtree's own occurrence is
 * visited).
 */
export function materializeDedupedNodes(
  trees: Record<string, DependenciesTree>,
): void {
  const roots = Object.values(trees).flatMap((tree) => [
    tree.dependencies,
    tree.devDependencies,
    tree.optionalDependencies,
    tree.unsavedDependencies,
  ]);

  const byIdentity = new Map<string, DependencyNode>();
  for (const nodes of roots) {
    collectFullyExpanded(nodes, byIdentity);
  }

  const resolvedIdentities = new Set<string>();
  for (const nodes of roots) {
    resolveDeduped(nodes, byIdentity, resolvedIdentities);
  }
}
