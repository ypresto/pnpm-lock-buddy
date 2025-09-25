import type { PnpmLockfile } from "./lockfile.js";
import { parsePackageString } from "./parser.js";
import type {
  DependencyPathStep,
  LinkedDependencyInfo,
  PackageDependencyInfo,
} from "./types.js";

/**
 * Tracks transitive dependencies and provides lookup functionality
 * to find which importers ultimately use a given package
 */
export class DependencyTracker {
  private lockfile: PnpmLockfile;
  private dependencyMap = new Map<string, PackageDependencyInfo>();
  private importerDependencies = new Map<string, Set<string>>(); // importer -> direct deps
  private importerCache = new Map<string, string[]>(); // packageId -> importers (cached)
  private linkedDependencies = new Map<string, LinkedDependencyInfo[]>(); // importer -> linked deps
  private dependencyPaths = new Map<string, DependencyPathStep[]>(); // Unified path cache
  private isInitialized = false;

  constructor(lockfile: PnpmLockfile) {
    this.lockfile = lockfile;
  }

  /**
   * Resolve link path to target importer path
   * Examples:
   * - link:../packages/logger from apps/web → packages/logger
   * - link:./packages/utils from . → packages/utils
   */
  private resolveLinkPath(
    sourceImporter: string,
    linkPath: string,
  ): string | null {
    // Remove 'link:' prefix
    const relativePath = linkPath.replace(/^link:/, "");

    if (sourceImporter === ".") {
      // Root importer cases
      if (relativePath.startsWith("./")) {
        return relativePath.substring(2);
      } else if (relativePath.startsWith("../")) {
        return relativePath.substring(3);
      } else {
        return relativePath;
      }
    }

    // Resolve relative path from source importer
    const sourceParts = sourceImporter.split("/");
    const relativeParts = relativePath.split("/");

    for (const part of relativeParts) {
      if (part === "..") {
        sourceParts.pop();
      } else if (part !== "." && part !== "") {
        sourceParts.push(part);
      }
    }

    const resolved = sourceParts.join("/");
    return resolved || ".";
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
        // Check if this is a linked dependency
        if (depInfo?.version?.startsWith("link:")) {
          const resolvedImporter = this.resolveLinkPath(
            importerPath,
            depInfo.version,
          );

          if (resolvedImporter && this.lockfile.importers[resolvedImporter]) {
            // Track this linked dependency
            if (!this.linkedDependencies.has(importerPath)) {
              this.linkedDependencies.set(importerPath, []);
            }
            this.linkedDependencies.get(importerPath)!.push({
              sourceImporter: importerPath,
              linkName: depName,
              resolvedImporter: resolvedImporter,
            });

            // Add both the original link format and resolved format to the deps set
            const originalLinkId = `${depName}@${depInfo.version}`; // @layerone/bakuraku-fetch@link:../../packages/webapp/bakuraku-fetch
            deps.add(originalLinkId);

            // Also add a simplified link format for easier matching
            const simpleLinkId = `${depName}@link:${resolvedImporter}`;
            deps.add(simpleLinkId);

            // Add all dependencies from the linked importer
            const linkedImporterData =
              this.lockfile.importers[resolvedImporter];
            const linkedAllDeps = {
              ...linkedImporterData.dependencies,
              ...linkedImporterData.devDependencies,
              ...linkedImporterData.optionalDependencies,
            };

            for (const [linkedDepName, linkedDepInfo] of Object.entries(
              linkedAllDeps || {},
            )) {
              let snapshotId = linkedDepInfo.version;

              // If the version string doesn't exist in snapshots, try to construct it
              if (!this.lockfile.snapshots?.[snapshotId]) {
                const candidateId = `${linkedDepName}@${linkedDepInfo.version}`;
                if (this.lockfile.snapshots?.[candidateId]) {
                  snapshotId = candidateId;
                }
              }

              deps.add(snapshotId);
            }
          }
        } else {
          // Regular dependency processing
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

  /**
   * Get linked dependencies for a given importer
   */
  getLinkedDependencies(importerPath: string): LinkedDependencyInfo[] {
    this.initialize();

    return this.linkedDependencies.get(importerPath) || [];
  }

  /**
   * Get dependency path from importer to package (unified API)
   */
  getDependencyPath(
    importerPath: string,
    packageId: string,
  ): DependencyPathStep[] {
    this.initialize();

    const cacheKey = `${importerPath}:${packageId}`;
    if (this.dependencyPaths.has(cacheKey)) {
      return this.dependencyPaths.get(cacheKey)!;
    }

    // Build path using unified logic - use first path from all paths
    const allPaths = this.buildAllUnifiedPaths(importerPath, packageId);
    const path = allPaths.length > 0 && allPaths[0] ? allPaths[0] : [];
    this.dependencyPaths.set(cacheKey, path);
    return path;
  }

  /**
   * Get all dependency paths from importer to package (for diamond dependencies)
   */
  getAllDependencyPaths(
    importerPath: string,
    packageId: string,
    maxDepth: number = 10,
  ): DependencyPathStep[][] {
    this.initialize();

    // Build all paths using unified logic
    const paths = this.buildAllUnifiedPaths(importerPath, packageId, maxDepth);
    return paths;
  }

  /**
   * Build all dependency paths using unified linked + non-linked traversal
   */
  private buildAllUnifiedPaths(
    importerPath: string,
    packageId: string,
    maxDepth: number = 10,
  ): DependencyPathStep[][] {
    const importerData = this.lockfile.importers[importerPath];
    if (!importerData) return [];

    const packageName = parsePackageString(packageId).name;
    const allPaths: DependencyPathStep[][] = [];

    // 1. Check if it's a direct dependency
    const directPath = this.checkDirectDependency(
      importerData,
      packageName,
      packageId,
    );
    if (directPath) {
      allPaths.push(directPath);
    }

    // 1b. Check if it's a dependency through a file: variant of the same importer
    // This handles cases where workspace packages have peer dep variants
    const fileVariantPath = this.checkFileVariantDependency(
      importerPath,
      packageName,
      packageId,
    );
    if (fileVariantPath) {
      allPaths.push(fileVariantPath);
    }

    // 2. Check if it comes through linked dependencies
    const linkedPath = this.checkLinkedDependencyPath(
      importerPath,
      packageName,
      packageId,
    );
    if (linkedPath.length > 0) {
      allPaths.push(linkedPath);
    }

    // 3. Find ALL transitive dependency paths
    const transitivePaths = this.traceAllTransitivePaths(
      importerPath,
      packageName,
      packageId,
      maxDepth,
    );
    allPaths.push(...transitivePaths);

    // 4. If no paths found, add fallback
    if (allPaths.length === 0) {
      allPaths.push([
        { package: packageId, type: "transitive", specifier: "transitive" },
      ]);
    }

    // Remove duplicate paths (same sequence of packages)
    return this.deduplicatePaths(allPaths);
  }

  /**
   * Check if dependency comes through a file: variant of the same importer
   */
  private checkFileVariantDependency(
    importerPath: string,
    packageName: string,
    packageId: string,
  ): DependencyPathStep[] | null {
    // Get the package name for this importer path
    // e.g., packages/webapp/foundation-react -> @layerone/foundation-react
    const importerName = this.getPackageNameFromImporterPath(importerPath);
    if (!importerName) {
      return null;
    }

    // Look for file: variants of this package in the packages section
    const filePrefix = `${importerName}@file:${importerPath}`;

    // Check all package entries that start with this prefix
    for (const [pkgKey, pkgData] of Object.entries(this.lockfile.packages || {})) {
      if (pkgKey.startsWith(filePrefix)) {
        // Check if this variant has the dependency we're looking for
        const depTypes = [
          { deps: pkgData.dependencies, type: "dependencies" },
          { deps: pkgData.optionalDependencies, type: "optionalDependencies" },
        ];

        for (const { deps, type } of depTypes) {
          if (deps?.[packageName] === packageId ||
              deps?.[packageName] === parsePackageString(packageId).version) {
            // Found it! Return path showing the full package variant name
            return [
              {
                package: pkgKey, // Use the full package key with peer deps
                type,
                specifier: pkgKey,
              },
            ];
          }
        }
      }
    }

    // Also check snapshots section for file: variants
    // Complex keys with peer deps often end up here instead of packages
    for (const [snapKey, snapData] of Object.entries(this.lockfile.snapshots || {})) {
      if (snapKey.startsWith(filePrefix)) {
        // Check if this snapshot has the dependency we're looking for
        const depTypes = [
          { deps: snapData.dependencies, type: "dependencies" },
          { deps: snapData.optionalDependencies, type: "optionalDependencies" },
        ];

        for (const { deps, type } of depTypes) {
          if (deps?.[packageName] === packageId ||
              deps?.[packageName] === parsePackageString(packageId).version) {
            // Found it! Return path showing the full snapshot key
            return [
              {
                package: snapKey, // Use the full snapshot key with peer deps
                type,
                specifier: deps[packageName],
              },
            ];
          }
        }
      }
    }

    return null;
  }

  /**
   * Get package name from importer path
   */
  private getPackageNameFromImporterPath(importerPath: string): string | null {
    // Look for the package.json name for this importer
    // For now, use a simple heuristic based on path
    if (importerPath.includes("packages/webapp/")) {
      const parts = importerPath.split("/");
      const packageName = parts[parts.length - 1];
      // Convert to scoped package name
      return `@layerone/${packageName}`;
    }
    return null;
  }

  /**
   * Check if package is a direct dependency
   */
  private checkDirectDependency(
    importerData: any,
    packageName: string,
    packageId: string,
  ): DependencyPathStep[] | null {
    const depTypes = [
      { deps: importerData.dependencies, type: "dependencies" },
      { deps: importerData.devDependencies, type: "devDependencies" },
      { deps: importerData.optionalDependencies, type: "optionalDependencies" },
      { deps: importerData.peerDependencies, type: "peerDependencies" },
    ];

    for (const { deps, type } of depTypes) {
      if (deps?.[packageName]) {
        const depInfo = deps[packageName];
        const depVersion = depInfo.version;

        // Check if this specific instance matches
        if (
          depVersion === packageId ||
          packageId === `${packageName}@${depVersion}` ||
          depVersion?.startsWith(packageId + "(") ||
          packageId?.startsWith(`${packageName}@${depVersion}`)
        ) {
          return [
            {
              package: packageId,
              type,
              specifier: depInfo.specifier,
            },
          ];
        }
      }
    }

    return null;
  }

  /**
   * Check if package comes through linked dependencies
   */
  private checkLinkedDependencyPath(
    importerPath: string,
    packageName: string,
    packageId: string,
  ): DependencyPathStep[] {
    const linkedDeps = this.getLinkedDependencies(importerPath);

    for (const linkedDep of linkedDeps) {
      // Check if target is direct dependency of linked package
      const linkedImporterData =
        this.lockfile.importers[linkedDep.resolvedImporter];
      if (linkedImporterData) {
        const linkedDirectPath = this.checkDirectDependency(
          linkedImporterData,
          packageName,
          packageId,
        );
        if (linkedDirectPath) {
          // Build path: link step + target step
          const linkStep: DependencyPathStep = {
            package: linkedDep.linkName,
            type: "dependencies", // Most links are in dependencies
            specifier: `link:${linkedDep.resolvedImporter}`,
          };
          return [linkStep, ...linkedDirectPath];
        }

        // New: Check if the packageId is a file: variant of the linked package itself
        // This happens when the linked package has different peer dependency resolutions
        if (
          packageName === linkedDep.linkName &&
          packageId.includes(`file:${linkedDep.resolvedImporter}`)
        ) {
          const linkStep: DependencyPathStep = {
            package: linkedDep.linkName,
            type: "dependencies",
            specifier: `link:${linkedDep.resolvedImporter}`,
          };

          // The file: version is essentially the same package with different peer deps
          const fileStep: DependencyPathStep = {
            package: packageId,
            type: "file",
            specifier: "file (peer dependency variant)",
          };

          return [linkStep, fileStep];
        }
      }
    }

    return [];
  }

  /**
   * Trace all transitive dependency paths through the dependency graph
   */
  private traceAllTransitivePaths(
    importerPath: string,
    packageName: string,
    packageId: string,
    maxDepth: number = 10,
  ): DependencyPathStep[][] {
    const importerData = this.lockfile.importers[importerPath];
    if (!importerData) return [];

    const allPaths: DependencyPathStep[][] = [];
    const cache = new Map<string, DependencyPathStep[][]>();
    const globalVisited = new Set<string>();

    // Performance limits for large monorepos (adjusted based on maxDepth)
    const MAX_TOTAL_PATHS = Math.min(50, maxDepth * 5); // Scale with depth
    const MAX_DIRECT_DEPS_TO_CHECK = Math.min(100, maxDepth * 10); // Scale with depth

    // Get all direct dependencies of the importer
    const allDirectDeps = {
      ...importerData.dependencies,
      ...importerData.devDependencies,
      ...importerData.optionalDependencies,
    };

    // Only check first N direct dependencies for performance
    const directDepsEntries = Object.entries(allDirectDeps || {}).slice(0, MAX_DIRECT_DEPS_TO_CHECK);

    // Try to find paths through each direct dependency
    for (const [directDepName, directDepInfo] of directDepsEntries) {
      // Early termination if we have enough paths already
      if (allPaths.length >= MAX_TOTAL_PATHS) {
        break;
      }

      if (directDepInfo?.version?.startsWith("link:")) {
        continue;
      }

      let directSnapshotId = this.findSnapshotId(
        directDepName,
        directDepInfo.version,
      );
      if (!directSnapshotId) {
        directSnapshotId = `${directDepName}@${directDepInfo.version}`;
      }

      // Use shared visited set with configurable depth limiting
      const paths = this.findAllPathsThroughSnapshot(
        directSnapshotId,
        packageName,
        packageId,
        globalVisited,
        Math.max(3, Math.min(maxDepth - 1, 20)), // Use maxDepth but cap at reasonable limit
        cache,
      );

      if (paths.length > 0) {
        let directDepType = "dependencies";
        if (importerData.devDependencies?.[directDepName]) {
          directDepType = "devDependencies";
        } else if (importerData.optionalDependencies?.[directDepName]) {
          directDepType = "optionalDependencies";
        }

        const directStep: DependencyPathStep = {
          package: directSnapshotId,
          type: directDepType,
          specifier: directDepInfo.specifier,
        };

        for (const path of paths) {
          allPaths.push([directStep, ...path]);
          if (allPaths.length >= MAX_TOTAL_PATHS) {
            break;
          }
        }
      }
    }

    return allPaths;
  }

  /**
   * Find all paths from a snapshot to target package through dependency graph
   */
  private findAllPathsThroughSnapshot(
    currentSnapshotId: string,
    targetPackageName: string,
    targetPackageId: string,
    visited: Set<string>,
    maxDepth: number,
    cache?: Map<string, DependencyPathStep[][]>,
  ): DependencyPathStep[][] {
    if (maxDepth <= 0 || visited.has(currentSnapshotId)) {
      return [];
    }

    // Create cache key for memoization
    const cacheKey = `${currentSnapshotId}:${targetPackageName}:${targetPackageId}:${maxDepth}`;
    if (cache?.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    visited.add(currentSnapshotId);

    const snapshotData = this.lockfile.snapshots?.[currentSnapshotId];
    if (!snapshotData) {
      visited.delete(currentSnapshotId);
      return [];
    }

    const snapshotDeps = {
      ...snapshotData.dependencies,
      ...snapshotData.optionalDependencies,
    };

    const allPaths: DependencyPathStep[][] = [];

    // AGGRESSIVE performance safeguard
    const MAX_PATHS_PER_SNAPSHOT = 5; // Very limited

    // Check if target package is a direct dependency of current snapshot
    for (const [depName, depVersion] of Object.entries(snapshotDeps || {})) {
      if (depName === targetPackageName) {
        const depSnapshotId =
          this.findSnapshotId(depName, depVersion) ||
          `${depName}@${depVersion}`;

        if (
          depSnapshotId === targetPackageId ||
          targetPackageId?.startsWith(`${depName}@${depVersion}`) ||
          depSnapshotId?.startsWith(targetPackageId)
        ) {
          allPaths.push([
            {
              package: targetPackageId,
              type: "dependencies",
              specifier: depVersion,
            },
          ]);

          // If we find direct dependency, prefer it and limit further search
          if (allPaths.length >= 3) {
            break;
          }
        }
      }
    }

    // Only search recursively if depth allows and we don't have many paths yet
    if (maxDepth > 1 && allPaths.length < MAX_PATHS_PER_SNAPSHOT) {
      // Limit how many dependencies we traverse recursively
      const depsToCheck = Object.entries(snapshotDeps || {}).slice(0, 10);

      for (const [depName, depVersion] of depsToCheck) {
        if (allPaths.length >= MAX_PATHS_PER_SNAPSHOT) {
          break;
        }

        const depSnapshotId =
          this.findSnapshotId(depName, depVersion) || `${depName}@${depVersion}`;

        const subPaths = this.findAllPathsThroughSnapshot(
          depSnapshotId,
          targetPackageName,
          targetPackageId,
          visited, // Critical: use same visited set
          maxDepth - 1,
          cache,
        );

        if (subPaths.length > 0) {
          const intermediateStep: DependencyPathStep = {
            package: depSnapshotId,
            type: "dependencies",
            specifier: depVersion,
          };

          for (const subPath of subPaths) {
            allPaths.push([intermediateStep, ...subPath]);
            if (allPaths.length >= MAX_PATHS_PER_SNAPSHOT) {
              break;
            }
          }
        }
      }
    }

    // Clean up visited set before returning
    visited.delete(currentSnapshotId);

    // Cache the result
    if (cache) {
      cache.set(cacheKey, allPaths);
    }

    return allPaths;
  }

  /**
   * Remove duplicate paths by comparing package sequences
   */
  private deduplicatePaths(
    paths: DependencyPathStep[][],
  ): DependencyPathStep[][] {
    const seen = new Set<string>();
    const uniquePaths: DependencyPathStep[][] = [];

    for (const path of paths) {
      // Create a signature based on the sequence of packages
      const signature = path.map((step) => step.package).join(" -> ");
      if (!seen.has(signature)) {
        seen.add(signature);
        uniquePaths.push(path);
      }
    }

    return uniquePaths;
  }
}
