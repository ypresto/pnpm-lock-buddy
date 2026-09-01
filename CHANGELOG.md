# Changelog

## [0.4.0] - 2026-08-31

### Added

- Support for pnpm v11.25.0/v12.0.0's multi-document `pnpm-lock.yaml` format (an "env" document ahead of the project document, written when config dependencies or a pinned pnpm version are present). `loadLockfile` now reads every document and uses the last one, per pnpm's own guidance for dependency-graph consumers, and ignores a trailing empty document produced by a bare trailing `---` separator.
- `list`/`search` command usage and a `duplicates`/`list` options reference to the README (previously undocumented).
- `README.md`: pnpm v9-v12 compatibility notes, a known limitation for named-registry (`namedRegistries`) packages using registry-qualified snapshot keys, and a "Caveats" section clarifying that this tool's pnpm-v12 support is lockfile-*format* compatibility, not "runs the same engine code" (pnpm v12's Rust engine no longer uses the `@pnpm/*` JS packages this tool depends on; pnpm v11's TS CLI still does, verified directly against both CLIs' published bundles).

### Fixed

- `resolveStorePathToLockfileKey` (`dep-path.ts`) fell back to an arbitrary, wrong-version lockfile candidate when a store path's installed version matched none of the candidates for that package name — a real case on any project where `node_modules` has drifted from `pnpm-lock.yaml` (installed a version the lockfile no longer lists). This silently merged every project resolving the real, drifted version into one fake "duplicate" instance keyed by whichever wrong-version candidate happened to sort first — confirmed on the real monorepo above: one such collision falsely attributed a package to 113 unrelated projects. Pre-existing, unrelated to the pnpm v12 work above; found while root-causing a duplicate-count discrepancy during that work's real-world verification. Now returns `null` in this case, same as having no candidates at all, so callers fall back to the raw (still correctly distinguishing) store path instead — re-verified against the same monorepo with the false attribution gone.

### Changed

- `@pnpm/dependency-path` → `@pnpm/deps.path` (same package, renamed upstream for the pnpm v11 generation; `depPathToFilename` usage is unchanged).
- `@pnpm/lockfile.types`: `^1002.0.1` → `^1100.1.0`.
- `@pnpm/reviewing.dependencies-hierarchy` → `@pnpm/deps.inspection.tree-builder` (renamed upstream; `buildDependenciesHierarchy`/`PackageNode` → `buildDependenciesTree`/`DependencyNode`).
  - The renamed library no longer throws when `node_modules` is absent or minimal (a behavior change from the old library, discovered via existing test regressions): it now silently returns a partial tree containing only workspace-link chains, dropping every npm-resolved package. `DependencyTracker` now checks for a real virtual store (`node_modules/.pnpm` containing at least one resolved package directory) before trusting the library's result, falling back to lockfile-only tree construction otherwise.
  - **Fixed, found via real-world testing against a 135-project production monorepo**: the renamed library also bounds a whole-workspace tree build to O(N) nodes by returning every repeat occurrence of an already-expanded subtree as an empty `deduped: true` stub. This codebase's traversal didn't know about that contract and silently treated every stub as a childless leaf — on the test monorepo, 41% of all nodes came back deduped, and duplicate detection dropped from 123 to 53 affected projects (a false ~8x speedup that was actually a correctness bug).
    - A first fix attempt (`src/core/tree-dedup.ts`, resolving each stub by matching `path`+`peersSuffixHash` against another occurrence anywhere in a whole-workspace `buildDependenciesTree(undefined, ...)` result) made this worse, not better: re-verification found it attributing one project's dependencies to a different, unrelated project (duplicate-package count went from a true 10019 to a fabricated 22958). Root cause, confirmed by reading the library's source (`getTree.js`): its real materialization-cache key is `(graph nodeId, remaining tree depth)`, neither of which is exposed on the public `DependencyNode` shape a fix could match against, so no external heuristic on that shape can safely reconstruct a deduped stub's real children when the cache spans multiple unrelated projects.
    - First fixed correctness by scoping each project's `buildDependenciesTree` call independently (`dependency-tracker.ts` calling it once per importer with a single-element `projectPaths` array) instead of once for the whole workspace — this eliminates cross-project cache sharing structurally, confirmed against pnpm's own CLI source: it uses this same per-project fallback pattern when it can't share a single-lockfile cache. Correct, but ~3.3x slower wall-clock on the 135-project test monorepo (~40s vs. baseline's ~12s) — one lockfile read per project instead of one for the whole workspace.
    - **Fixed the performance regression too**, without giving up correctness: `buildTreesFromPnpm` now calls `buildDependenciesTree` once for the whole workspace again, but with `depth: Infinity` (never a finite depth) instead of `this.depth`. At infinite depth the library's cache key (`getTree.js`'s `materializeCacheKey`) collapses to the bare node identity — the "remaining tree depth" component that made the per-project split necessary doesn't exist anymore, so a single batched call sharing one cache across every project is safe again. `--depth` is now enforced by this codebase while walking the (depth-unbounded) result instead of by the tree-builder call (`computeShallowestDepths` in the new `tree-depth.ts`, a BFS giving each node its shallowest reachable depth; wired into `traverseTreeAndBuildMap`, `collectFromTreeNodes`, and the `findPathInTree`/`findAllPathsInTree` recursion caps). Also added `canonicalizeLinkVersions` (`tree-dedup.ts`): a workspace `link:` node's `version` is rebased by the library to whichever project's traversal first materialized its subtree (`rewriteLinkVersionDir`) — wrong for every other project reusing that subtree from the now-shared cache — so every link node's version is rewritten relative to `lockfileDir` instead, using its context-independent absolute `path`. Re-verified on the same 135-project monorepo: exact project-count match (123/123) with the per-project fix, duplicate-package count within 0.06% (an expected small variance in which project ends up "first" to materialize a shared subtree, not a regression), no cross-project misattribution in spot checks (including a dedicated peer-dependency-variant scenario), and ~10x faster than the per-project version — beating the original whole-workspace baseline.
  - Minor fix found in the same pass: the same physical workspace-linked package, reached at different relative depths (`link:../eslint-plugin` vs. `link:../../packages/shared/eslint-plugin`), was reported as two separate "duplicate" instances in `duplicates.usecase.ts`. Its instance-identity fallback now keys off the link's resolved `path` instead of the depth-dependent `link:...` version string (`linkNodeIdentity` in `dep-path.ts`). Not applied to `dependency-tracker.ts`'s own copy of the same method, which relies on the old fallback format as a sentinel elsewhere (`getDisplayId`) for its circular-dependency-path detection.
- `engines.node`: `>=14.0.0` → `>=22.13.0`, matching what the packages above actually require. CI (`test-action.yml`) now uses Node 22.
- `@types/node`: `^20.10.0` → `^22.10.0`, matching the new `engines.node` floor.

### Removed

- `@pnpm/lockfile-file` dependency (unused).

## [0.2.4] - 2026-03-19

### Fixed

- Fix `findLockfileKey` failing to distinguish same-version candidates with different nested peer dependency versions. Packages like `next-navigation-guard@0.1.2` resolved with `@babel/core@7.27.7` vs `@babel/core@7.28.6` were collapsed into a single instance, hiding the duplicate.
  - Root cause: the peer extraction regex `/@([a-z0-9@/-]+)/gi` did not include `.` in the character class, so version numbers like `7.27.7` and `7.28.6` were both truncated to `7`, producing zero distinguishing peers.
  - Replaced the heuristic store-path-to-lockfile-key matching with deterministic matching using `@pnpm/dependency-path`'s `depPathToFilename`.
- Fix `--per-project` mode not detecting same-version-different-peer-deps as duplicates. The per-project duplicate check compared base versions (stripping peer deps), so two instances of `pkg@1.0.0` with different peer resolutions were not flagged. Now compares instance IDs instead.
- Fix store path hash detection to handle pnpm v9 base32 hashes (26 chars, MD5) in addition to pnpm v10 hex hashes (32 chars, SHA-256). When the exact hash doesn't match (different pnpm versions use different hash algorithms), falls back to prefix matching on the deterministic part before the hash suffix.
- Fix `--deps` tree displaying the same peer dep variant for all instances. The `dependency-tracker.ts` had its own copy of the buggy `findLockfileKey` that wasn't updated. Now both callsites share `resolveStorePathToLockfileKey`.
- Fix `findPathInTree` loose matching (`startsWith`) incorrectly matching the first node with the same base version, even when the node's resolved lockfile key pointed to a different peer dep variant.
- Fix per-project version numbering resetting per `(project, package)` pair instead of per package across all projects.

### Added

- `@pnpm/dependency-path` as a direct dependency for reliable store path resolution.

## [0.2.3] - 2026-01-28

### Added

- Detect duplicates with same version but different peer dependencies (`--print-store-path`).
- `--ignore-dev` option (shorthand for `--omit=dev`) to both `list` and `duplicates` commands.
- Display dev and optional flags for linked dependencies.
- Preserve intermediate linked dependencies in tree representation.

### Fixed

- Fix duplicate project names in global mode with `--deps`.
- Fix `--ignore-dev` filtering to actually omit dev dependencies.

## [0.2.1] - 2025-11-17

### Fixed

- Fix `--deps` option not showing correct dependency trees for all versions.
- Use contextualized snapshots for link dependencies in `@file:` packages.
- Remove extra vertical line in single-path dependency trees.

## [0.2.0] - 2025-10-22

### Added

- `--hoist` option to check `node_modules/.modules.yaml` for actually hoisted package conflicts.
- Per-project mode enhancements: show hoisted info, treat hoisted version mismatches as duplicates.
- Optimize `--hoist` to show only packages with hoisted conflicts.

### Fixed

- Fix per-project duplicate detection by using actual project as key.
- Fix link resolution and enrich pnpm trees with linked workspace deps.
- Include `optionalDependencies` when building transitive dependency trees.
- Fix nested workspace link tracking for transitive dependencies.
- Fix infinite recursion by tracking node IDs instead of object references.
- Fix version numbering to be per-package instead of global.
- Fix `--project` filter to show only instances used by filtered projects.

### Performance

- Optimize `--deps` option with path limiting and caching.
- Skip expensive dependency info computation when not needed.
- Make dependency map lazy to save ~2s in duplicate detection.

## [0.1.0] - 2025-10-02

### Added

- `--depth` CLI option to control dependency tree depth.
- Pure tree-based dependency path resolution using `@pnpm/reviewing.dependencies-hierarchy`.
- Auto-switch to per-project format for `file:` variants.
- Validation for `--project` option to check if projects exist.
- Sorting by cleaned project names for better organization.

### Fixed

- Fix `--deps` option missing intermediate dependencies in workspace peer variants.
- Fix dependency path display with intermediate dependencies.
- Fix tree formatting (vertical bars, prefixes).
- Fix `--deps-depth` not being respected.

## [0.0.1] - 2025-09-01

### Added

- Initial release.
- `list` command to search and display packages in `pnpm-lock.yaml`.
- `duplicates` command to find packages with multiple installations.
- `--deps` option to show dependency tree paths from root to target packages.
- `--omit` option to filter by dependency type (dev, optional, peer).
- `--per-project` mode to group duplicates by importer/project.
- Wildcard support in package name arguments.
- Version numbering for duplicate instances.
- Dev, optional, and peer dependency indicators.
- Linked workspace package tracking.
