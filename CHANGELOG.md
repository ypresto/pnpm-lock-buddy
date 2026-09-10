# Changelog

## [0.4.1] - 2026-09-04

### Added

- Verify against a real pnpm v12 install.
- Add `pnpm test:e2e`: end-to-end tests using real pnpm v11/v12 installs.

### Fixed

- Correct docs: only pnpm v12 writes the multi-document lockfile format (v11 only reads it).
- Fix CI self-test depending on the npm-published version instead of the current commit.

## [0.4.0] - 2026-08-31

### Added

- Support pnpm v12's multi-document lockfile format (env + project documents).
- Document `list`/`search` usage and `duplicates`/`list` options in the README.

### Fixed

- Fix wrong-version fallback when `node_modules` drifts from the lockfile.
- Fix duplicate detection undercounting caused by unhandled deduped tree nodes.
- Fix duplicate workspace-link entries at different relative depths.

### Changed

- Migrate to `@pnpm/deps.path` and `@pnpm/deps.inspection.tree-builder` (renamed upstream).
- Bump `engines.node` to >=22.13.0.

### Removed

- Remove unused `@pnpm/lockfile-file` dependency.

## [0.2.4] - 2026-03-19

### Fixed

- Fix `findLockfileKey` not distinguishing same-version candidates with different peer dependencies.
- Fix `--per-project` mode not detecting same-version-different-peer-deps as duplicates.
- Fix store path hash detection for pnpm v9 base32 hashes alongside pnpm v10 hex hashes.
- Fix `--deps` tree displaying the same peer dep variant for all instances.
- Fix `findPathInTree` loose matching picking the wrong peer dep variant.
- Fix per-project version numbering resetting per project instead of per package.

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
