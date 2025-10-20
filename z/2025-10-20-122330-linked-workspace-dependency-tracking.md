# Investigation: Non-Injected Workspace Dependencies Tracking Issue

## Date
2025-10-20

## Issue Description

In `~/repo/github.com-private/LayerXcom/layerone-webapps-5`:
- `foundation-react` has react v18 (injected)
- `foundation-react` depends on `bakuraku-fetch` (workspace dependency via `link:`)
- `bakuraku-fetch` is NOT injected (appears as "linked" in pnpm-lock.yaml)
- `bakuraku-fetch` depends on react v19
- **Runtime Issue**: react v19 from bakuraku-fetch causes version mismatch

## Root Cause

The `DependencyTracker` class in `src/core/dependency-tracker.ts` doesn't correctly track **nested/transitive workspace links**.

### Current Behavior (Lines 164-201)

When `buildTreesFromLockfile()` encounters a linked dependency:

1. It resolves the link to the target importer
2. It adds all dependencies from the linked importer to the current importer's tree
3. **BUT**: It doesn't recursively follow nested links

### Example Scenario

```
ui-react (has react v18)
  └─ link: foundation-react
      ├─ react: 18.2.0
      └─ link: bakuraku-fetch
          └─ react: 19.1.1
```

**Current Behavior**:
- `ui-react` tree includes: react@18.2.0 (direct), react@18.2.0 (from foundation-react)
- `ui-react` does NOT track react@19.1.1 from bakuraku-fetch
- Only `foundation-react` and `bakuraku-fetch` are tracked as using react@19.1.1

**Expected Behavior**:
- `ui-react` should ALSO be tracked as using react@19.1.1 (transitively through nested links)

## Reproduction Tests

Created three test cases in `test/unit/core/dependency-tracker.test.ts`:

1. ✅ **Single-level link**: `foundation-react -> link:bakuraku-fetch -> react@19.1.1`
   - **PASSES**: foundation-react correctly tracks react@19.1.1

2. ✅ **Version conflict detection**: Same as above with additional lodash dependency
   - **PASSES**: Both react versions and lodash are tracked

3. ❌ **Multi-level nested links**: `ui-react -> link:foundation-react -> link:bakuraku-fetch -> react@19.1.1`
   - **FAILS**: ui-react does NOT track react@19.1.1
   - Expected: `['packages/webapp/bakuraku-fetch', 'packages/webapp/foundation-react', 'packages/webapp/ui-react']`
   - Actual: `['packages/webapp/bakuraku-fetch', 'packages/webapp/foundation-react']`

## Test Output

```
react19Importers: [
  'packages/webapp/bakuraku-fetch',
  'packages/webapp/foundation-react'
]
```

Missing: `'packages/webapp/ui-react'`

## Code Location

File: `src/core/dependency-tracker.ts:164-201`

The issue is in the link resolution logic. When processing dependencies from a linked importer, if those dependencies are themselves links, they should be recursively resolved.

## Fix Applied

### Changes Made

1. **Added `buildLinkedDependencyNodes()` method** (lines 206-271)
   - Recursively builds dependency nodes from linked importers
   - Handles nested workspace links
   - Includes cycle detection with `visitedImporters` set to prevent infinite recursion

2. **Modified `buildTreesFromLockfile()`** (lines 141-204)
   - Replaced inline link resolution with call to `buildLinkedDependencyNodes()`
   - Now properly handles nested workspace links

3. **Enhanced `buildTransitiveDepsFromLockfile()`** (lines 273-335)
   - Added `visitedImporters` parameter to track visited workspace packages
   - Added special handling for injected workspace dependencies (`file:` prefix)
   - When processing `file:` dependencies, extracts the importer path and recursively includes its linked dependencies

4. **Added `extractImporterPathFromFileVersion()`** helper (lines 337-344)
   - Extracts importer path from `file:` version strings
   - E.g., `"file:packages/webapp/ui-react(...)"` → `"packages/webapp/ui-react"`

### Test Results

All 4 new reproduction tests now **PASS**:

✅ **Single-level link**: `foundation-react -> link:fetch-utils -> react@19.1.1`
✅ **Version conflict detection**: Both react v18 and v19 tracked correctly
✅ **Multi-level nested links**: `ui-react -> link:foundation-react -> link:fetch-utils -> react@19.1.1`
✅ **Injected + linked**: `apps/attendance-webapp -> file:ui-react -> link:fetch-utils -> react@19.1.1`

Full test suite: **83 tests passed, 9 skipped, 0 failed**

### Files Modified

- `src/core/dependency-tracker.ts` - Added recursive link resolution
- `test/unit/core/dependency-tracker.test.ts` - Added 4 reproduction tests

## Impact

This fix ensures that workspace monorepos correctly track dependencies through:
- Multiple levels of workspace links (A links to B links to C)
- Mixed injected and linked workspace dependencies
- Version conflicts in deeply nested workspace structures

The `duplicates` command will now correctly identify version conflicts even when they occur through multiple levels of workspace dependencies.
