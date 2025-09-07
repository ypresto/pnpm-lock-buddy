import type { PnpmLockfile } from "./lockfile.js";
import { parsePackageString } from "./parser.js";
import { traverseLockfile } from "./traverser.js";
import chalk from "chalk";

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
 * Check if a package is a link dependency in the lockfile
 */
export function isLinkDependency(
  lockfile: PnpmLockfile,
  packageName: string,
): boolean {
  const { name: targetPackage } = parsePackageString(packageName);
  let isLink = false;

  traverseLockfile(lockfile, (context) => {
    const { key, value, path } = context;

    // Check in importers section for link dependencies
    if (path[0] === "importers" && path.length === 4) {
      const depType = path[2] as
        | "dependencies"
        | "devDependencies"
        | "optionalDependencies";
      const isDepSection = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ].includes(depType);

      if (isDepSection && key === targetPackage) {
        const depInfo = value as { specifier: string; version: string };
        if (depInfo.version.startsWith("link:")) {
          isLink = true;
          return false; // Stop traversal
        }
      }
    }

    return true; // Continue traversal
  });

  return isLink;
}

/**
 * Find all link dependencies referenced by package names
 */
export function findLinkDependencies(
  lockfile: PnpmLockfile,
  packageNames: string[],
): string[] {
  if (packageNames.length === 0) return [];

  const linkDeps: Set<string> = new Set();
  const targetPackages = new Set(
    packageNames.map((pkg) => parsePackageString(pkg).name),
  );

  traverseLockfile(lockfile, (context) => {
    const { key, value, path } = context;

    // Check in importers section for link dependencies
    if (path[0] === "importers" && path.length === 4) {
      const depType = path[2] as
        | "dependencies"
        | "devDependencies"
        | "optionalDependencies";
      const isDepSection = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ].includes(depType);

      if (isDepSection && targetPackages.has(key)) {
        const depInfo = value as { specifier: string; version: string };
        if (depInfo.version.startsWith("link:")) {
          // Find original package name from the input list
          const originalName = packageNames.find(
            (pkg) => parsePackageString(pkg).name === key,
          );
          if (originalName) {
            linkDeps.add(originalName);
          }
        }
      }
    }

    return true; // Continue traversal
  });

  return Array.from(linkDeps);
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

/**
 * Display warning message about link dependencies
 */
export function displayLinkDependencyWarning(linkDeps: string[]): void {
  if (linkDeps.length === 0) return;

  const packageList = linkDeps.map((pkg) => `"${pkg}"`).join(", ");
  const isPlural = linkDeps.length > 1;

  console.error(
    chalk.yellow(
      `Warning: Package${isPlural ? "s" : ""} ${packageList} ${isPlural ? "have" : "has"} link ${isPlural ? "dependencies" : "dependency"} and ${isPlural ? "might" : "might"} not be listed in the packages section of the lock file.`,
    ),
  );
}
