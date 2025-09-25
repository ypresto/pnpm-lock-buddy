import type { PnpmLockfile } from "./lockfile.js";
import { parsePackageString } from "./parser.js";
import { traverseLockfile } from "./traverser.js";

/**
 * Check if a package exists in the lockfile
 */
export function packageExists(
  lockfile: PnpmLockfile,
  packageName: string,
): boolean {
  const { name: targetPackage } = parsePackageString(packageName);
  let found = false;

  traverseLockfile(lockfile, (context) => {
    const { key, path } = context;

    // Check in packages section (most reliable)
    if (path[0] === "packages" && path.length === 2) {
      const parsed = parsePackageString(key);
      if (parsed.name === targetPackage) {
        found = true;
        return false; // Stop traversal
      }
    }

    // Also check in importers dependencies/devDependencies/optionalDependencies
    // for workspace packages that use aliases (like @layerone/bakuraku-fetch)
    if (path[0] === "importers" && path.length === 4 && 
        (path[2] === "dependencies" || path[2] === "devDependencies" || path[2] === "optionalDependencies")) {
      if (key === targetPackage) {
        found = true;
        return false; // Stop traversal
      }
    }

    return true; // Continue traversal
  });

  return found;
}

/**
 * Check if multiple package names exist in the lockfile
 */
export function validatePackages(
  lockfile: PnpmLockfile,
  packageNames: string[],
): { existing: string[]; missing: string[] } {
  const existing: string[] = [];
  const missing: string[] = [];

  for (const packageName of packageNames) {
    if (packageExists(lockfile, packageName)) {
      existing.push(packageName);
    } else {
      missing.push(packageName);
    }
  }

  return { existing, missing };
}

/**
 * Check if a package name matches a wildcard pattern
 * Supports * wildcard matching
 * Examples:
 * - "react*" matches "react", "react-dom", "react-scripts"
 * - "@types/*" matches "@types/node", "@types/react"
 * - "*eslint*" matches "eslint", "@typescript-eslint/parser"
 */
export function matchesWildcard(packageName: string, pattern: string): boolean {
  // If no wildcard, use exact match
  if (!pattern.includes("*")) {
    return packageName === pattern;
  }

  // Convert wildcard pattern to regex
  // Escape special regex characters except *
  const escapedPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape special chars
    .replace(/\*/g, ".*"); // Convert * to .*

  const regex = new RegExp(`^${escapedPattern}$`);
  return regex.test(packageName);
}

/**
 * Check if a package name matches any of the wildcard patterns
 */
export function matchesAnyWildcard(
  packageName: string,
  patterns: string[],
): boolean {
  return patterns.some((pattern) => matchesWildcard(packageName, pattern));
}
