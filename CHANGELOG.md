# Changelog

## [0.2.4] - 2026-03-19

### Fixed

- Fix `findLockfileKey` failing to distinguish same-version candidates with different nested peer dependency versions. Packages like `next-navigation-guard@0.1.2` resolved with `@babel/core@7.27.7` vs `@babel/core@7.28.6` were collapsed into a single instance, hiding the duplicate.
  - Root cause: the peer extraction regex `/@([a-z0-9@/-]+)/gi` did not include `.` in the character class, so version numbers like `7.27.7` and `7.28.6` were both truncated to `7`, producing zero distinguishing peers.
  - Replaced the heuristic store-path-to-lockfile-key matching with deterministic matching using `@pnpm/dependency-path`'s `depPathToFilename`.
- Fix `--per-project` mode not detecting same-version-different-peer-deps as duplicates. The per-project duplicate check compared base versions (stripping peer deps), so two instances of `pkg@1.0.0` with different peer resolutions were not flagged. Now compares instance IDs instead.

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
