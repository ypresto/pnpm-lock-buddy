# pnpm-lock-buddy

A powerful tool for analyzing dependency duplicates and workspace conflicts in pnpm-lock.yaml files. Designed for large monorepos to detect critical runtime issues and bundle bloat.

## Why This Tool?

Large monorepos often suffer from:
- 🚨 **Runtime module conflicts** from the same package loaded multiple ways
- 📦 **Bundle bloat** from duplicate packages with different versions
- 🔗 **Workspace link issues** causing `link:` vs `file:` resolution conflicts
- 🤔 **Complex dependency chains** that are hard to trace
- ⚡ **TypeScript ESLint conflicts** from different plugin versions

This tool reveals exactly **how** and **why** duplicates exist, with actionable dependency paths.

## Installation

```bash
pnpm install -g pnpm-lock-buddy
```

## Commands

### `pnpm-lock-buddy duplicates` - Find duplicate packages

Identify packages with multiple installations across your project.

```bash
# Find all duplicates
pnpm-lock-buddy duplicates

# Filter by specific packages (supports wildcards)
pnpm-lock-buddy duplicates react lodash @types/react
pnpm-lock-buddy duplicates "react*" "@types/*"

# Group by project (shows which projects have internal duplicates)
pnpm-lock-buddy duplicates --per-project

# Show dependency tree paths (how packages are included)
pnpm-lock-buddy duplicates --deps
pnpm-lock-buddy duplicates --per-project --deps

# Filter by project (comma-separated)
pnpm-lock-buddy duplicates --project packages/webapp/ui-react
pnpm-lock-buddy duplicates --project "apps/web,packages/ui"

# Combined filtering with dependency trees
pnpm-lock-buddy duplicates react --project packages/webapp/ui-react --per-project --deps

# Omit dependency types (dev, optional, peer)
pnpm-lock-buddy duplicates --omit dev --omit optional

# Limit tree depth for better readability
pnpm-lock-buddy duplicates --deps --deps-depth 3

# CI/CD: Fail build if duplicates found
pnpm-lock-buddy duplicates --exit-code
pnpm-lock-buddy duplicates react lodash --exit-code
```

**Options:**

- `-f, --file <path>` - Path to pnpm-lock.yaml file
- `-a, --all` - Show all packages, not just duplicates
- `-p, --per-project` - Group duplicates by importer/project instead of globally
- `--project <projects>` - Filter by specific project paths (comma-separated, e.g., `"apps/web,packages/ui"`)
- `--deps` - Show dependency tree paths from root to target packages
- `--deps-depth <number>` - Limit dependency tree display depth (shows `...` for deeper paths)
- `--depth <number>` - Depth for building dependency tree (default: 10, increase for deep monorepos)
- `--omit <types...>` - Omit dependency types: dev, optional, peer (e.g., `--omit dev --omit optional`)
- `--exit-code` - Exit with code 1 if duplicate packages are found (useful for CI/CD)
- `-o, --output <format>` - Output format: tree, json (default: tree)

### `pnpm-lock-buddy list` - Search for packages

Search for specific packages or list all packages in the lockfile.

```bash
# Search for a specific package
pnpm-lock-buddy list express
pnpm-lock-buddy list express@4.18.2
pnpm-lock-buddy list @types/react

# List all packages
pnpm-lock-buddy list

# Filter by project
pnpm-lock-buddy list react --project "apps/web" "packages/ui"

# Output formats
pnpm-lock-buddy list express --output json
pnpm-lock-buddy list express --output list
```

**Options:**

- `-f, --file <path>` - Path to pnpm-lock.yaml file
- `-e, --exact` - Only match exact versions listed in lockfile (semver range specifier not matches with this)
- `-p, --project <projects...>` - Filter by specific importer/project paths
- `-o, --output <format>` - Output format: tree, json, list (default: tree)

## Environment Variables

- `PNPM_LOCK_PATH` - Default path to pnpm-lock.yaml file

## Output Explanation

### List Output

```text
importers
  apps/web-app
    dependencies
      => react
         specifier: ^18.2.0
         version: 18.2.0(@types/react@18.2.0)(react-dom@18.2.0) [1]
```

- **Green text**: Base version (18.2.0)
- **Magenta text**: Peer dependency constraints (@types/react@18.2.0)(react-dom@18.2.0)
- **[1]**: Version suffix when multiple peer dependency combinations exist
  - It is [NPM doppelgangers](https://pnpm.io/settings#dedupepeerdependents) which happens when there is [peer dependency conflict](https://pnpm.io/settings#dedupepeerdependents).

### Duplicates Output

```text
react has 2 instances:
  react@18.2.0 (dependencies)
    Used by: apps/web-app, packages/ui-lib
  react@19.1.1 (devDependencies)
    Used by: apps/experimental
```

- **(dependencies)**: Dependency type
- **Used by**: Projects that use this instance (includes transitive dependencies)

## CI/CD Integration

The `--exit-code` option makes the tool suitable for continuous integration:

```bash
# Fail build if any duplicates are found
pnpm-lock-buddy duplicates --exit-code

# Check specific critical packages
pnpm-lock-buddy duplicates react react-dom --exit-code

# Per-project duplicate check in CI
pnpm-lock-buddy duplicates --per-project --exit-code
```

**Exit Code Behavior:**
- **Exit Code 0**: No duplicates found (or `--all` flag used)
- **Exit Code 1**: Duplicates found and `--exit-code` specified
- **Exit Code 1**: Package validation errors or other errors

**Note**: The `--all` flag disables exit code 1 since it's informational mode.

## Features

- ✅ **Version matching** with semver support (`^7.0.0 || ^8.0.1`)
- ✅ **Exact matching** with `--exact` flag
- ✅ **Transitive dependency tracking**
- ✅ **Per-project duplicate detection**
- ✅ **Colorized output** with peer dependency highlighting
- ✅ **Multiple output formats** (tree, JSON, list)
- ✅ **Project filtering** for monorepo analysis
- ✅ **Package validation** with helpful error messages

## Real-World Use Cases

### 🚨 Critical: Detect Dual Resolution Conflicts

**Problem:** Same package loaded via both `link:` and `file:` mechanisms causing runtime errors.

```bash
# Detect critical conflicts
node dist/cli/index.js duplicates --per-project "@layerone/bakuraku-fetch"
```

**Output:**
```
@layerone/bakuraku-fetch:
  apps/payer-nextjs-webapp: has 2 instances
    @layerone/bakuraku-fetch@file:packages/webapp/bakuraku-fetch(react@18.2.0)  ← Via snapshots
    @layerone/bakuraku-fetch@link:../../packages/webapp/bakuraku-fetch           ← Via importers
```

**Solution:** Remove redundant direct links where packages are already transitively available.

### 🔍 Find Root Cause of Version Conflicts

**Problem:** Different ESLint plugins bringing conflicting TypeScript ESLint versions.

```bash
# Trace dependency chains
node dist/cli/index.js duplicates --per-project --deps @typescript-eslint/types
```

**Output:**
```
@typescript-eslint/types:
  packages/shared/eslint-config: has 2 instances
    packages/shared/eslint-config
    ├─(D)─ eslint-plugin-storybook@9.0.7(...)
    │  │  │  └─(d)─ @typescript-eslint/types@8.38.0  ← v8.38.0 via storybook

    packages/shared/eslint-config
    ├─(D)─ eslint-plugin-import@2.32.0(...)
    │  │  │  └─(d)─ @typescript-eslint/types@8.39.0  ← v8.39.0 via import
```

**Solution:** Update `eslint-plugin-storybook` to align with `eslint-plugin-import` version.

### 🎯 Focus on Production Dependencies

**Problem:** Too many dev dependency duplicates cluttering analysis.

```bash
# Show only production dependencies
node dist/cli/index.js duplicates --per-project --omit=dev --omit=optional
```

**Output:**
```
react:
  apps/web: has 2 instances
    react@18.2.0 (d)
    react@19.1.1 (d)  ← Critical production conflict!
```

### 🔎 Find Packages by Pattern

**Problem:** Need to check all React or AWS SDK related duplicates.

```bash
# Wildcard patterns
node dist/cli/index.js duplicates --per-project "react*"      # All React packages
node dist/cli/index.js duplicates --per-project "@types/*"   # All TypeScript types
node dist/cli/index.js duplicates --per-project "*eslint*"   # All ESLint packages
```

### 📊 Project-Specific Analysis

**Problem:** Investigate duplicates in specific apps or packages.

```bash
# Focus on specific project with dependency trees
node dist/cli/index.js duplicates --per-project --deps --project apps/web lodash

# Global view with project filtering
node dist/cli/index.js duplicates --deps --project apps/web -- react-hook-form
```

### Dependency Type Indicators

- **`(d)`** = dependencies | **`(D)`** = devDependencies | **`(o)`** = optionalDependencies
- **`(p)`** = peerDependencies | **`(L)`** = linked dependency | **`(t)`** = transitive

### Advanced Options

```bash
# Customize dependency tree depth
node dist/cli/index.js duplicates --per-project --deps --max-depth 5

# JSON output for tooling integration
node dist/cli/index.js duplicates --per-project --output=json
```

## License

MIT
