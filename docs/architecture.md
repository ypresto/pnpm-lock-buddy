# pnpm-lock-buddy Architecture

## Overview

pnpm-lock-buddy is a CLI tool for analyzing pnpm-lock.yaml files, providing functionality to list packages and detect duplicate installations.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLI Entry Point                            │
│                    (pnpm-lock-buddy.js)                         │
│         ┌─────────────────┬──────────────────┐                  │
│         │     list       │   duplicates     │                  │
│         │   command      │    command       │                  │
│         └─────────────────┴──────────────────┘                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                        UseCase Layer                             │
│         ┌─────────────────┬──────────────────┐                  │
│         │  ListUsecase    │ DuplicatesUsecase│                  │
│         └─────────────────┴──────────────────┘                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                       Core Modules                               │
│  ┌─────────────┬──────────────┬──────────────┬──────────────┐ │
│  │   Parser    │   Lockfile   │  Traverser   │   Matcher    │ │
│  │             │    Loader    │              │              │ │
│  └─────────────┴──────────────┴──────────────┴──────────────┘ │
│  ┌─────────────┬──────────────┬──────────────┬──────────────┐ │
│  │  Formatter  │    Logger    │   Config     │    Utils     │ │
│  │             │              │              │              │ │
│  └─────────────┴──────────────┴──────────────┴──────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## Component Descriptions

### CLI Layer

#### pnpm-lock-buddy.js
- Main entry point
- Command routing using Commander.js
- Global options handling (--file, --verbose, etc.)
- Error handling and exit codes

#### Commands

- **list**: Find packages by name/version with semver matching
- **duplicates**: Identify packages with multiple instances

### UseCase Layer

#### ListUsecase
- Implements package search logic
- Handles exact and fuzzy matching
- Formats search results

#### DuplicatesUsecase
- Detects packages with multiple installations
- Analyzes differences in transitive dependencies
- Groups and sorts duplicate instances

### Core Modules

#### Parser (src/core/parser.ts)
- Parse package strings: `name@version(dep@version)`
- Handle scoped packages: `@org/package`
- Extract version and dependency information
- Validate package names and versions

#### Lockfile Loader (src/core/lockfile.ts)
- Load pnpm-lock.yaml files
- Cache parsed content
- Provide typed access to lockfile sections
- Handle different lockfile versions

#### Traverser (src/core/traverser.ts)
- Generic tree traversal with callbacks
- Path tracking during traversal
- Depth and breadth-first options
- Section-specific traversal methods

#### Matcher (src/core/matcher.ts)
- Semver version matching
- Handle OR operators in version specs
- Exact vs. fuzzy matching modes
- Version range validation

#### Formatter (src/core/formatter.ts)
- Tree visualization
- JSON output
- Table formatting
- Color coding for terminal output

#### Logger (src/core/logger.ts)
- Verbosity levels (debug, info, warn, error)
- Structured logging
- File output option
- Progress indicators

#### Config (src/core/config.ts)
- Default paths and options
- Environment variable handling
- User configuration files
- Runtime option merging

#### Utils (src/core/utils.ts)
- Common utility functions
- File system helpers
- String manipulation
- Error handling utilities

## Data Models

### Package
```javascript
{
  name: string,
  version: string,
  scope?: string,
  specifier?: string,
  dependencies?: Record<string, string>,
  peerDependencies?: Record<string, string>,
  optionalDependencies?: Record<string, string>,
  path?: string[]
}
```

### ListResult
```javascript
{
  package: Package,
  locations: Array<{
    path: string[],
    type: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency',
    parent?: string,
    context: object
  }>,
  matchType: 'exact' | 'semver'
}
```

### DuplicateInstance
```javascript
{
  packageName: string,
  baseVersion: string,
  instances: Array<{
    fullIdentifier: string,
    dependencies: Record<string, string>,
    locations: string[],
    count: number
  }>
}
```

## Design Principles

1. **Modularity**: Each component has a single responsibility
2. **Testability**: All core modules are unit-testable
3. **Extensibility**: Easy to add new commands and features
4. **Performance**: Efficient traversal and caching strategies
5. **User Experience**: Clear output, helpful error messages
6. **Backward Compatibility**: Can replicate original script behavior

## File Structure

```
pnpm-lock-buddy/
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── list.ts
│   │       └── duplicates.ts
│   ├── usecases/
│   │   ├── list.usecase.ts
│   │   └── duplicates.usecase.ts
│   └── core/
│       ├── parser.ts
│       ├── lockfile.ts
│       ├── traverser.ts
│       ├── matcher.ts
│       ├── formatter.ts
│       ├── logger.ts
│       ├── config.ts
│       └── utils.ts
├── test/
│   ├── fixtures/
│   │   └── simple-lock.yaml
│   ├── unit/
│   │   └── core/
│   └── integration/
├── old/
│   ├── pnpm-yaml-search.js
│   └── pnpm-dep-instances.js
├── package.json
├── vitest.config.js
└── README.md
```

## Technology Stack

- **Runtime**: Node.js 14+
- **Language**: TypeScript 5.3+
- **CLI Framework**: Commander.js
- **YAML Parser**: js-yaml
- **Version Matching**: semver
- **Testing**: Vitest
- **Linting**: ESLint with TypeScript support
- **Formatting**: Prettier
