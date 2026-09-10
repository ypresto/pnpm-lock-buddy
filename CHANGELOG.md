# Changelog

## [0.4.1] - 2026-09-04

### Added

- **Verified against a real pnpm v12 install**: the production monorepo referenced under 0.4.0 was later upgraded to pnpm v12.2.1 in real use — a genuine multi-document lockfile and a real `node_modules/.pnpm` with ~7900 installed entries, not a synthetic fixture. This tool ran against it cleanly (123/123 projects via `--per-project`, no crashes, ~2.3s), consistent with the pnpm v11.9.0 run documented under 0.4.0.
- `pnpm test:e2e`: an end-to-end test suite that runs a real `pnpm install` with the latest pnpm v11 and v12 CLIs (via `pnpm dlx`, independent of this repo's own pinned pnpm) against one workspace fixture combining a workspace, a `workspace:*` link, a catalog entry, and peer dependencies, and asserts pnpm-lock-buddy's duplicate detection is identical across both. Excluded from the default `pnpm test` run (needs network access, much slower) via a separate `vitest.e2e.config.ts`.

### Fixed

- **README/CHANGELOG correction**: 0.4.0 claimed the multi-document lockfile format was "introduced in pnpm v11.25.0/v12.0.0"; real installs show writing it is v12-only. v11.25.0 reads and preserves an existing multi-document lockfile but never creates one itself, even with `packageManager` pinned; v12 does the opposite, rewriting an existing single-document lockfile to multi-document on any `install`, even a no-op one.
- The GitHub Action's own CI self-test (`test-action.yml`) installed pnpm-lock-buddy from the npm registry at whatever version `package.json` declared, so it failed on every push between bumping that version and actually publishing it. Now packs the current commit (`pnpm pack`) and points the action at that local tarball instead, so it always tests the commit under test rather than a (possibly not-yet-published) version string — see `duplicates/run.sh` and `duplicates/action.yml`'s `version` input, which now also accepts a local tarball path.

No runtime behavior changed in this release; it's a verification and tooling-only release.

## [0.4.0] - 2026-08-31

### Added

- Support for pnpm v11.25.0/v12.0.0's multi-document `pnpm-lock.yaml` format (an "env" document ahead of the project document, written when config dependencies or a pinned pnpm version are present). `loadLockfile` now reads every document and uses the last one, per pnpm's own guidance for dependency-graph consumers, and ignores a trailing empty document produced by a bare trailing `---` separator. (See 0.4.1: only pnpm v12 actually writes this format.)
- `list`/`search` command usage and a `duplicates`/`list` options reference to the README (previously undocumented).
- `README.md`: pnpm v9-v12 compatibility notes, a known limitation for named-registry (`namedRegistries`) packages using registry-qualified snapshot keys, and a "Caveats" section clarifying that this tool's pnpm-v12 support is lockfile-*format* compatibility, not "runs the same engine code" (pnpm v12's Rust engine no longer uses the `@pnpm/*` JS packages this tool depends on; pnpm v11's TS CLI still does, verified directly against both CLIs' published bundles).

### Fixed

- `resolveStorePathToLockfileKey` (`dep-path.ts`) fell back to an arbitrary, wrong-version lockfile candidate when a store path's installed version matched none of the candidates for that package name — happens when `node_modules` has drifted from `pnpm-lock.yaml` (an installed version the lockfile no longer lists). This silently merged every project resolving that drifted version into one fake "duplicate" instance (confirmed on the real monorepo above: one such collision falsely attributed a package to 113 unrelated projects). Now returns `null` in this case instead, so callers fall back to the raw store path.

### Changed

- `@pnpm/dependency-path` → `@pnpm/deps.path` (same package, renamed upstream for the pnpm v11 generation; `depPathToFilename` usage is unchanged).
- `@pnpm/lockfile.types`: `^1002.0.1` → `^1100.1.0`.
- `@pnpm/reviewing.dependencies-hierarchy` → `@pnpm/deps.inspection.tree-builder` (renamed upstream; `buildDependenciesHierarchy`/`PackageNode` → `buildDependenciesTree`/`DependencyNode`).
  - The renamed library no longer throws when `node_modules` is absent or minimal: it now silently returns a partial tree containing only workspace-link chains, dropping every npm-resolved package. `DependencyTracker` now checks for a real virtual store (`node_modules/.pnpm` containing at least one resolved package directory) before trusting the library's result, falling back to lockfile-only tree construction otherwise.
  - **Fixed a duplicate-detection undercount, found via real-world testing against a 135-project production monorepo**: the library bounds a whole-workspace tree build to O(N) nodes by returning every repeat occurrence of an already-expanded subtree as an empty `deduped: true` stub, which this codebase's traversal didn't know about and treated as a childless leaf (duplicate detection dropped from 123 to 53 affected projects on the test monorepo). Fixed via `materializeDedupedNodes`/`canonicalizeLinkVersions` (`tree-dedup.ts`): `buildTreesFromPnpm` calls `buildDependenciesTree` once for the whole workspace with `depth: Infinity`, which makes the library's internal per-node cache key unambiguous across projects; `--depth` is now enforced by this codebase's own BFS walk (`tree-depth.ts`) instead of by the tree-builder call, and applies only to `--deps` path search, never to duplicate detection itself (detection is a depth-unbounded BFS over an already-deduped tree, so it's safe; unbounded path *enumeration* through a wide graph would not be). Re-verified on the same monorepo: exact project-count match (123/123), an exhaustive duplicate-package count of 23663 with no cross-project misattribution, and ~10x faster than an earlier per-project workaround.
  - Minor fix found in the same pass: the same physical workspace-linked package, reached at different relative depths (`link:../eslint-plugin` vs. `link:../../packages/shared/eslint-plugin`), was reported as two separate "duplicate" instances in `duplicates.usecase.ts`. Its instance-identity fallback now keys off the link's resolved `path` instead of the depth-dependent `link:...` version string (`linkNodeIdentity` in `dep-path.ts`).
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
