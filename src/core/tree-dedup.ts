import path from "path";
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
 * CALLER CONTRACT — `trees` MUST come from a single `buildDependenciesTree`
 * call scoped to ONE project (a single-element `projectPaths` array), never
 * from a call spanning multiple projects. The library's real cache key is
 * `(graph nodeId, remaining tree depth)` (see `getTree.js`'s
 * `materializeCacheKey`), neither of which is exposed on the public
 * `DependencyNode` shape this function receives. The `path`+`peersSuffixHash`
 * key below is only a safe proxy for that when every node in `trees`
 * originates from the same project's own dependency graph — spanning
 * multiple projects' results let it substitute one project's dependencies
 * onto a different, unrelated project's tree (confirmed on the same
 * monorepo above: reverted, see git history and CHANGELOG for that
 * incident). `dependency-tracker.ts` calls `buildDependenciesTree` once per
 * project specifically so this contract holds.
 *
 * Residual limitation even within one project: this key still cannot
 * distinguish two occurrences of the same node reached at genuinely
 * different remaining depths (rare, but possible in a single project's own
 * graph). Where that happens, the substituted subtree may be shallower or
 * deeper than the library would have produced for that exact occurrence.
 * This is a narrower, project-local version of the same identity gap, not
 * fully closed — see the follow-up task on adding a real multi-project
 * fixture regression test that would also help characterize this.
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
