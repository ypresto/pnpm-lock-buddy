import type { PnpmLockfile } from "./lockfile.js";
import { parsePackageString } from "./parser.js";

export interface DependencyInfo {
  importers: Set<string>;
  directDependents: Set<string>; // Packages that directly depend on this package
}

/**
 * Tracks transitive dependencies and provides lookup functionality
 * to find which importers ultimately use a given package
 */
export class DependencyTracker {
  private lockfile: PnpmLockfile;
  private dependencyMap = new Map<string, DependencyInfo>();
  private importerDependencies = new Map<string, Set<string>>(); // importer -> direct deps
  private importerCache = new Map<string, string[]>(); // packageId -> importers (cached)
  private isInitialized = false;

  constructor(lockfile: PnpmLockfile) {
    this.lockfile = lockfile;
  }

  /**
   * Initialize the dependency tracking by building the complete dependency graph
   */
  private initialize(): void {
    if (this.isInitialized) return;

    // Step 1: Collect direct dependencies from importers
    this.buildImporterDependencies();

    // Step 2: Build the reverse dependency map from snapshots
    this.buildDependencyMap();

    // Step 3: Resolve transitive dependencies
    this.resolveTransitiveDependencies();

    this.isInitialized = true;
  }

  /**
   * Collect direct dependencies for each importer
   */
  private buildImporterDependencies(): void {
    for (const [importerPath, importerData] of Object.entries(
      this.lockfile.importers,
    )) {
      const deps = new Set<string>();

      // Collect all types of dependencies
      const allDeps = {
        ...importerData.dependencies,
        ...importerData.devDependencies,
        ...importerData.optionalDependencies,
      };

      for (const [depName, depInfo] of Object.entries(allDeps || {})) {
        // The version string might be just a version or include peer deps
        // Try to find the actual snapshot ID
        let snapshotId = depInfo.version;

        // If the version string doesn't exist in snapshots, try to construct it
        if (!this.lockfile.snapshots?.[snapshotId]) {
          // Try with package name + version
          const candidateId = `${depName}@${depInfo.version}`;
          if (this.lockfile.snapshots?.[candidateId]) {
            snapshotId = candidateId;
          }
        }

        deps.add(snapshotId);
      }

      this.importerDependencies.set(importerPath, deps);
    }
  }

  /**
   * Build the reverse dependency map from snapshots
   */
  private buildDependencyMap(): void {
    // Initialize dependency info for all packages
    for (const snapshotId of Object.keys(this.lockfile.snapshots || {})) {
      if (!this.dependencyMap.has(snapshotId)) {
        this.dependencyMap.set(snapshotId, {
          importers: new Set(),
          directDependents: new Set(),
        });
      }
    }

    // Build direct dependency relationships from snapshots
    for (const [snapshotId, snapshotData] of Object.entries(
      this.lockfile.snapshots || {},
    )) {
      const allDeps = {
        ...snapshotData.dependencies,
        ...snapshotData.optionalDependencies,
      };

      for (const [depName, depVersion] of Object.entries(allDeps || {})) {
        // Find the actual snapshot ID for this dependency
        const depSnapshotId = this.findSnapshotId(depName, depVersion);
        if (depSnapshotId) {
          // Ensure both packages exist in the map
          if (!this.dependencyMap.has(depSnapshotId)) {
            this.dependencyMap.set(depSnapshotId, {
              importers: new Set(),
              directDependents: new Set(),
            });
          }

          // Record that snapshotId depends on depSnapshotId
          this.dependencyMap
            .get(depSnapshotId)!
            .directDependents.add(snapshotId);
        }
      }
    }
  }

  /**
   * Find the snapshot ID for a given package name and version
   */
  private findSnapshotId(packageName: string, version: string): string | null {
    // First try exact match with version
    const exactMatch = `${packageName}@${version}`;
    if (this.lockfile.snapshots && this.lockfile.snapshots[exactMatch]) {
      return exactMatch;
    }

    // Then try to find a snapshot that starts with the package name and version
    for (const snapshotId of Object.keys(this.lockfile.snapshots || {})) {
      const parsed = parsePackageString(snapshotId);
      if (parsed.name === packageName && parsed.version === version) {
        return snapshotId;
      }
    }

    return null;
  }

  /**
   * Resolve transitive dependencies using DFS
   */
  private resolveTransitiveDependencies(): void {
    // For each importer, find all packages it transitively depends on
    for (const [
      importerPath,
      directDeps,
    ] of this.importerDependencies.entries()) {
      const allTransitiveDeps = new Set<string>();

      // Use DFS to find all transitive dependencies
      const visited = new Set<string>();
      const stack = Array.from(directDeps);

      while (stack.length > 0) {
        const currentDep = stack.pop()!;
        if (visited.has(currentDep)) continue;

        visited.add(currentDep);
        allTransitiveDeps.add(currentDep);

        // Look for this dependency in snapshots (could be the exact ID or need to find matching one)
        let snapshotData = this.lockfile.snapshots?.[currentDep];

        if (!snapshotData) {
          // Try to find by parsing the current dependency
          const parsed = parsePackageString(currentDep);
          const foundSnapshotId = this.findSnapshotId(
            parsed.name,
            parsed.version || "",
          );
          if (foundSnapshotId) {
            snapshotData = this.lockfile.snapshots?.[foundSnapshotId];
          }
        }

        if (snapshotData) {
          // Add all dependencies of this package to the stack
          const subDeps = {
            ...snapshotData.dependencies,
            ...snapshotData.optionalDependencies,
          };

          for (const [subDepName, subDepVersion] of Object.entries(
            subDeps || {},
          )) {
            const subDepId =
              this.findSnapshotId(subDepName, subDepVersion) ||
              `${subDepName}@${subDepVersion}`;
            if (!visited.has(subDepId)) {
              stack.push(subDepId);
            }
          }
        }
      }

      // Record that this importer uses all these packages transitively
      for (const depId of allTransitiveDeps) {
        if (!this.dependencyMap.has(depId)) {
          this.dependencyMap.set(depId, {
            importers: new Set(),
            directDependents: new Set(),
          });
        }
        this.dependencyMap.get(depId)!.importers.add(importerPath);
      }
    }
  }

  /**
   * Get all importers that use a given package (directly or transitively)
   */
  getImportersForPackage(packageId: string): string[] {
    this.initialize();

    // Check cache first
    if (this.importerCache.has(packageId)) {
      return this.importerCache.get(packageId)!;
    }

    const depInfo = this.dependencyMap.get(packageId);
    if (!depInfo) {
      const emptyResult: string[] = [];
      this.importerCache.set(packageId, emptyResult);
      return emptyResult;
    }

    const result = Array.from(depInfo.importers).sort();
    this.importerCache.set(packageId, result);
    return result;
  }

  /**
   * Get all packages that directly depend on a given package
   */
  getDirectDependentsForPackage(packageId: string): string[] {
    this.initialize();

    const depInfo = this.dependencyMap.get(packageId);
    if (!depInfo) {
      return [];
    }

    return Array.from(depInfo.directDependents).sort();
  }

  /**
   * Check if a package is used by any importer
   */
  isPackageUsed(packageId: string): boolean {
    this.initialize();

    const depInfo = this.dependencyMap.get(packageId);
    return depInfo ? depInfo.importers.size > 0 : false;
  }
}
