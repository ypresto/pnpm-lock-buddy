# pnpm-lock-buddy

CLI tool for analyzing pnpm-lock.yaml files. Search for packages, detect duplicates, and understand dependency relationships in your monorepo.

## Installation

```bash
pnpm install -g pnpm-lock-buddy
```

## Commands

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

### `pnpm-lock-buddy duplicates` - Find duplicate packages

Identify packages with multiple installations across your project.

```bash
# Find all duplicates
pnpm-lock-buddy duplicates

# Filter by specific packages
pnpm-lock-buddy duplicates react lodash @types/react

# Group by project (shows which projects have internal duplicates)
pnpm-lock-buddy duplicates --per-project

# Filter by project
pnpm-lock-buddy duplicates --project "apps/web"

# Combined filtering
pnpm-lock-buddy duplicates react --project "apps/web" --per-project

# CI/CD: Fail build if duplicates found
pnpm-lock-buddy duplicates --exit-code

# CI/CD: Check specific packages and fail if duplicates
pnpm-lock-buddy duplicates react lodash --exit-code
```

**Options:**

- `-f, --file <path>` - Path to pnpm-lock.yaml file
- `-a, --all` - Show all packages, not just duplicates
- `-p, --per-project` - Group duplicates by importer/project instead of globally
- `--project <projects...>` - Filter by specific importer/project paths
- `--exit-code` - Exit with code 1 if duplicate packages are found (useful for CI/CD)
- `-o, --output <format>` - Output format: tree, json (default: tree)

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

## License

MIT
