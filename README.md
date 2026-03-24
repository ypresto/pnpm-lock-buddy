# pnpm-lock-buddy

A tool for detecting duplicate package installations in pnpm monorepos. Finds packages resolved with different versions or different peer dependencies that cause runtime conflicts and bundle bloat.

## Installation

```bash
pnpm install -g pnpm-lock-buddy
```

## Quick Start

```bash
# Find all duplicate packages
pnpm-lock-buddy duplicates

# Check specific packages (supports wildcards)
pnpm-lock-buddy duplicates react "react*" "@types/*"

# Show which projects have duplicates
pnpm-lock-buddy duplicates --per-project

# Show dependency paths (how duplicates are included)
pnpm-lock-buddy duplicates --per-project --deps

# Ignore dev dependencies
pnpm-lock-buddy duplicates --omit dev

# CI/CD: exit code 1 if duplicates found
pnpm-lock-buddy duplicates --exit-code
```

## Use Case: Detect Same Package with Different Peer Dependencies

A common issue in monorepos is the same package being resolved with different peer dependency versions. This creates multiple instances at runtime, breaking shared state like React Context.

```bash
pnpm-lock-buddy duplicates --per-project --deps next-navigation-guard
```

```
next-navigation-guard:
  apps/my-webapp: has 2 instances
    └─(link:)─ @acme/webapp-boosters@link:../../packages/webapp/webapp-boosters
       └─── next-navigation-guard@0.1.2(next@16.1.5(@babel/core@7.27.7)...) [1]
    └─── next-navigation-guard@0.1.2(next@16.1.5(@babel/core@7.28.6)...) [2]
```

Both instances are `0.1.2`, but resolved with different `@babel/core` versions (`7.27.7` vs `7.28.6`), causing `next` to be instantiated twice and breaking `NavigationGuardProvider`.

## GitHub Action

Use `ypresto/pnpm-lock-buddy/duplicates@v1` to check for duplicates in CI:

```yaml
- uses: ypresto/pnpm-lock-buddy/duplicates@v1
  with:
    packages: 'next react react-dom @types/react'
```

The step fails if duplicates are found. Set `comment: 'true'` to post results as a collapsible PR comment.

### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `packages` | (required) | Space-separated package names (supports wildcards) |
| `per-project` | `true` | Group duplicates by project |
| `deps` | `false` | Show dependency tree paths |
| `omit` | | Dependency types to omit (e.g., `dev optional`) |
| `lockfile` | | Path to pnpm-lock.yaml |
| `ignore-file` | `.pnpm-lock-buddy-ignore` | Path to ignore file |
| `comment` | `false` | Post results as a collapsible PR comment (needs `pull-requests: write`) |
| `max-old-space-size` | `8192` | Node.js heap size in MB |
| `version` | (bundled) | pnpm-lock-buddy version |
| `extra-args` | | Additional CLI arguments |

### Ignore File

Create `.pnpm-lock-buddy-ignore` to suppress known-acceptable duplicates:

```
# Ignore all duplicates in a project
apps/storybook

# Ignore specific package in a project
apps/web:@types/react
```

## Options

```
-f, --file <path>       Path to pnpm-lock.yaml file
-a, --all               Show all packages, not just duplicates
-p, --per-project       Group duplicates by project
--project <projects>    Filter by project paths (comma-separated)
--deps                  Show dependency tree paths
--deps-depth <number>   Limit tree display depth
--depth <number>        Dependency tree build depth (default: 10)
--omit <types...>       Omit: dev, optional, peer
--ignore-dev            Shorthand for --omit dev
--ignore-file <path>    Path to ignore file for suppressing results
--print-store-path      Show pnpm store paths instead of lockfile keys
--exit-code             Exit 1 if duplicates found (for CI/CD)
-o, --output <format>   Output format: tree, json
```

## Output Format

**Global mode** (default):
```
react has 2 instances:
  react@18.2.0 [1] (dependencies)
    Used by: apps/web, packages/ui
  react@19.1.1 [2] (dependencies)
    Used by: apps/experimental
```

**Per-project mode** (`--per-project`):
```
react:
  apps/web: has 2 instances
    ├─── react@18.2.0 [1]
    └─── react@19.1.1 [2]
```

- **[1], [2]**: Instance numbers (per package, consistent across projects)
- **(dependencies)**: Dependency type

## License

MIT
