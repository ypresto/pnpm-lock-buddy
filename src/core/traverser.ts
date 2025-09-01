import type { PnpmLockfile } from "./lockfile.js";

export interface TraversalContext {
  key: string;
  value: any;
  path: string[];
  parent: any;
  type?:
    | "dependency"
    | "devDependency"
    | "peerDependency"
    | "optionalDependency";
}

export type TraversalCallback = (context: TraversalContext) => void | boolean;

export interface TraversalOptions {
  includeImporters?: boolean;
  includePackages?: boolean;
  includeSnapshots?: boolean;
}

/**
 * Generic object traversal helper
 */
function traverseObject(
  obj: any,
  callback: TraversalCallback,
  path: string[] = [],
  parent: any = null,
): boolean {
  if (!obj || typeof obj !== "object") {
    return true;
  }

  for (const [key, value] of Object.entries(obj)) {
    const context: TraversalContext = {
      key,
      value,
      path: [...path, key],
      parent,
    };

    // Call the callback
    const shouldContinue = callback(context);

    // If callback returns false, stop traversal
    if (shouldContinue === false) {
      return false;
    }

    // Recursively traverse nested objects
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const continueTraversal = traverseObject(
        value,
        callback,
        context.path,
        obj,
      );
      if (!continueTraversal) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Traverse the entire lockfile structure
 */
export function traverseLockfile(
  lockfile: PnpmLockfile,
  callback: TraversalCallback,
  options: TraversalOptions = {},
): void {
  const {
    includeImporters = true,
    includePackages = true,
    includeSnapshots = true,
  } = options;

  // Traverse importers
  if (includeImporters && lockfile.importers) {
    const shouldContinue = traverseObject(
      lockfile.importers,
      callback,
      ["importers"],
      lockfile,
    );
    if (!shouldContinue) return;
  }

  // Traverse packages
  if (includePackages && lockfile.packages) {
    const shouldContinue = traverseObject(
      lockfile.packages,
      callback,
      ["packages"],
      lockfile,
    );
    if (!shouldContinue) return;
  }

  // Traverse snapshots
  if (includeSnapshots && lockfile.snapshots) {
    traverseObject(lockfile.snapshots, callback, ["snapshots"], lockfile);
  }
}

/**
 * Traverse only the packages section
 */
export function traversePackages(
  packages: PnpmLockfile["packages"],
  callback: TraversalCallback,
): void {
  traverseObject(packages, callback, ["packages"]);
}

/**
 * Traverse only the importers section
 */
export function traverseImporters(
  importers: PnpmLockfile["importers"],
  callback: TraversalCallback,
): void {
  traverseObject(importers, callback, ["importers"]);
}

/**
 * Traverse only the snapshots section
 */
export function traverseSnapshots(
  snapshots: PnpmLockfile["snapshots"] | undefined,
  callback: TraversalCallback,
): void {
  if (snapshots) {
    traverseObject(snapshots, callback, ["snapshots"]);
  }
}

/**
 * Find all occurrences of a package in the lockfile
 */
export function findPackageOccurrences(
  lockfile: PnpmLockfile,
  packageName: string,
): TraversalContext[] {
  const occurrences: TraversalContext[] = [];

  traverseLockfile(lockfile, (context) => {
    // Check in importers dependencies
    if (
      context.path[0] === "importers" &&
      context.path.length === 4 &&
      context.key === packageName
    ) {
      occurrences.push({
        ...context,
        type: context.path[2] as any,
      });
    }

    // Check in packages section (top-level keys)
    if (
      context.path[0] === "packages" &&
      context.path.length === 2 &&
      (context.key === packageName || context.key.startsWith(`${packageName}@`))
    ) {
      occurrences.push(context);
    }

    // Check in snapshots section (top-level keys)
    if (
      context.path[0] === "snapshots" &&
      context.path.length === 2 &&
      (context.key === packageName || context.key.startsWith(`${packageName}@`))
    ) {
      occurrences.push(context);
    }

    // Check in dependencies within packages/snapshots
    if (
      (context.path[0] === "packages" || context.path[0] === "snapshots") &&
      context.path.length === 4 &&
      context.key === packageName
    ) {
      occurrences.push({
        ...context,
        type: context.path[2] as any,
      });
    }
  });

  return occurrences;
}
