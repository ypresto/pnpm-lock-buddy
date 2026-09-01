import path from "path";
import type {
  DependenciesTree,
  DependencyNode,
} from "@pnpm/deps.inspection.tree-builder";

/**
 * Unique identity key for a DependencyNode within a tree build's
 * materialization cache. `path` alone is already sufficient in practice —
 * confirmed directly (test/unit/core/tree-builder-batch-integration.test.ts):
 * for a real `package`-type node, the virtual-store path itself encodes the
 * full resolved depPath, peer suffix included, so two differently-resolved
 * peer variants of the same package always get different `path`s too.
 * `peersSuffixHash` is folded in anyway as harmless, redundant defense in
 * depth in case some node shape doesn't hold that invariant.
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
 * @pnpm/deps.inspection.tree-builder bounds a tree build to O(N) nodes by
 * materializing each distinct subtree only once per `buildDependenciesTree`
 * call: every later occurrence of the same node comes back as a
 * `deduped: true` stub with no `dependencies` of its own (see the library's
 * `MaterializationCache`, documented in its `getTree.d.ts`). Consumers that
 * walk `.dependencies` per node — as this codebase's duplicate-detection and
 * usage-tracking logic does — would otherwise silently treat a deduped stub
 * as a leaf, undercounting real duplicate instances underneath it.
 *
 * Confirmed against a real ~135-project monorepo: 41% of all returned nodes
 * came back deduped, and duplicate detection dropped from 123 to 53 affected
 * projects before accounting for this.
 *
 * CALLER CONTRACT — `trees` MUST come from a `buildDependenciesTree` call
 * made with `depth: Infinity`, whether that call is scoped to one project or
 * batches every project at once. A call with any FINITE depth spanning more
 * than one project is forbidden — the library's real cache key is (graph
 * nodeId, remaining tree depth) (see `getTree.js`'s `materializeCacheKey`),
 * and at finite depth neither half of that key is exposed on the public
 * `DependencyNode` shape this function receives; the `path`+`peersSuffixHash`
 * key below was tried as a proxy for it at finite depth across a
 * multi-project batch and it substituted one project's dependencies onto a
 * different, unrelated project's tree (confirmed on a real monorepo,
 * reverted — see git history and CHANGELOG for that incident).
 *
 * At `depth: Infinity` this danger doesn't exist: `materializeCacheKey`
 * special-cases it to return the bare nodeId, dropping the depth component
 * of the key entirely — so every occurrence of a given node, in any project,
 * caches to the same entry and gets the same (complete, untruncated)
 * content. `path`+`peersSuffixHash` is then a safe, redundant proxy for that
 * nodeId (see `dependency-tracker.ts`'s `buildTreesFromPnpm`, which always
 * passes `depth: Infinity` to the library and enforces `--depth` itself
 * while walking the result instead — never pass a finite depth to the
 * library from a new call site without re-reading this).
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

function canonicalizeLinkVersionsIn(
  nodes: DependencyNode[] | undefined,
  lockfileDir: string,
  visited: Set<DependencyNode[]>,
): void {
  if (!nodes || visited.has(nodes)) return;
  visited.add(nodes);

  for (const node of nodes) {
    if (node.version.startsWith("link:") && path.isAbsolute(node.path)) {
      node.version = `link:${path.relative(lockfileDir, node.path)}`;
    }
    canonicalizeLinkVersionsIn(node.dependencies, lockfileDir, visited);
  }
}

/**
 * `@pnpm/deps.inspection.tree-builder` rewrites a workspace `link:` node's
 * `version` to be relative to whichever project's `buildDependenciesTree`
 * traversal first materialized that subtree (`rewriteLinkVersionDir`,
 * computed once per top-level call and threaded through every node it
 * produces — see `getPkgInfo.js`). In a batch call spanning multiple
 * projects, a shared subtree's link versions stay relative to that first
 * ("donor") project even when reused — under a different, unrelated
 * project's own tree — for every project that reuses it via the
 * materialization cache.
 *
 * `node.path` has no such problem: it's always the link target's absolute,
 * resolved directory, independent of which project's traversal reached it.
 * This rewrites every link node's `version` to be relative to `lockfileDir`
 * (the workspace root) instead, using that absolute path — a single fixed
 * basis valid from anywhere in the batch result, replacing whatever
 * project-relative form the library computed. Idempotent: safe to call
 * whether or not a given version was already relative to `lockfileDir`.
 *
 * Call together with materializeDedupedNodes (order doesn't matter — this
 * walks the fully-restored tree either way) whenever `trees` may contain
 * content shared across more than one project. Skips nodes built by the
 * lockfile-only fallback tree builder (`buildTreesFromLockfile`), which use
 * a relative placeholder path (`node_modules/<name>`), not an absolute one.
 */
export function canonicalizeLinkVersions(
  trees: Record<string, DependenciesTree>,
  lockfileDir: string,
): void {
  const visited = new Set<DependencyNode[]>();
  for (const tree of Object.values(trees)) {
    canonicalizeLinkVersionsIn(tree.dependencies, lockfileDir, visited);
    canonicalizeLinkVersionsIn(tree.devDependencies, lockfileDir, visited);
    canonicalizeLinkVersionsIn(tree.optionalDependencies, lockfileDir, visited);
    canonicalizeLinkVersionsIn(tree.unsavedDependencies, lockfileDir, visited);
  }
}
