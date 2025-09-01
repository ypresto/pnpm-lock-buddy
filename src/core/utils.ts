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
