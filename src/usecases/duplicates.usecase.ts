import type { PnpmLockfile } from "../core/lockfile.js";
import { parsePackageString } from "../core/parser.js";
import { traverseLockfile } from "../core/traverser.js";
import { validatePackages, matchesAnyWildcard } from "../core/utils.js";
import {
  formatDuplicates,
  formatPerProjectDuplicates,
  type DuplicateInstance,
} from "../core/formatter.js";
import { DependencyTracker } from "../core/dependency-tracker.js";

export interface DuplicatesOptions {
  showAll?: boolean;
  packageFilter?: string[];
  projectFilter?: string[];
  omitTypes?: string[]; // "dev", "optional", "peer"
  maxDepth?: number; // Maximum depth for dependency path traversal
}

export type OutputFormat = "tree" | "json";

interface PackageInstance {
  id: string;
  packageName: string;
  version: string;
  dependencies: Record<string, string>;
  projects: Set<string>;
}

export interface PerProjectDuplicate {
  importerPath: string;
  duplicatePackages: ProjectPackageDuplicate[];
}

export interface DependencyPathStep {
  package: string;
  type: string;
  specifier: string;
}

export interface DependencyInfo {
  typeSummary: string;
  path: DependencyPathStep[];
}

export interface ProjectPackageDuplicate {
  packageName: string;
  instances: Array<{
    id: string;
    version: string;
    dependencies: Record<string, string>;
    dependencyInfo: DependencyInfo;
  }>;
}

export class DuplicatesUsecase {
  private dependencyTracker: DependencyTracker;
  private pathCache = new Map<string, DependencyPathStep[]>(); // Cache for expensive path calculations
  private currentMaxDepth = 10; // Default max depth

  constructor(private lockfile: PnpmLockfile) {
    this.dependencyTracker = new DependencyTracker(lockfile);
  }

  /**
   * Check if a dependency type should be omitted based on omitTypes filter
   */
  private shouldOmitDependencyType(
    dependencyPath: string,
    omitTypes?: string[],
  ): boolean {
    if (!omitTypes || omitTypes.length === 0) return false;

    // Map CLI options to dependency types
    const typeMapping = {
      dev: ["devDependencies"],
      optional: ["optionalDependencies"],
      peer: ["peerDependencies"],
    };

    for (const omitType of omitTypes) {
      const typesToCheck =
        typeMapping[omitType as keyof typeof typeMapping] || [];
      for (const typeToCheck of typesToCheck) {
        if (dependencyPath.includes(typeToCheck)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Find packages that have multiple instances with different dependencies
   */
  findDuplicates(options: DuplicatesOptions = {}): DuplicateInstance[] {
    const { showAll = false, packageFilter, projectFilter } = options;

    // Collect all package instances from snapshots
    const instancesMap = new Map<string, PackageInstance>();
    const packageGroups = new Map<string, string[]>(); // packageName -> instanceIds

    // First, collect all instances from snapshots
    traverseLockfile(this.lockfile, (context) => {
      const { key, value, path } = context;

      if (path[0] === "snapshots" && path.length === 2) {
        const instanceId = key;
        const parsed = parsePackageString(instanceId);

        if (parsed.name) {
          const dependencies = (value as any).dependencies || {};
          const optionalDependencies =
            (value as any).optionalDependencies || {};

          const instance: PackageInstance = {
            id: instanceId,
            packageName: parsed.name,
            version: parsed.version || "",
            dependencies: { ...dependencies, ...optionalDependencies },
            projects: new Set(),
          };

          instancesMap.set(instanceId, instance);

          // Group by package name
          if (!packageGroups.has(parsed.name)) {
            packageGroups.set(parsed.name, []);
          }
          packageGroups.get(parsed.name)!.push(instanceId);
        }
      }
    });

    // Also collect link: entries from importers section as separate instances
    traverseLockfile(this.lockfile, (context) => {
      const { key, value, path } = context;

      if (path[0] === "importers" && path.length === 4 && path[1]) {
        const importerPath = path[1];
        const packageName = key;
        const depInfo = value as { specifier: string; version: string };

        // Check if this is a link dependency
        if (depInfo.version.startsWith("link:")) {
          const linkInstanceId = `${packageName}@${depInfo.version}`;
          const parsed = parsePackageString(linkInstanceId);

          if (parsed.name) {
            // Create synthetic instance for the link entry
            const linkInstance: PackageInstance = {
              id: linkInstanceId,
              packageName: parsed.name,
              version: parsed.version || depInfo.version,
              dependencies: {}, // Link entries don't have their own dependencies
              projects: new Set([importerPath]),
            };

            instancesMap.set(linkInstanceId, linkInstance);

            // Group by package name
            if (!packageGroups.has(parsed.name)) {
              packageGroups.set(parsed.name, []);
            }
            packageGroups.get(parsed.name)!.push(linkInstanceId);
          }
        }
      }
    });

    // Now find where each instance is used
    traverseLockfile(this.lockfile, (context) => {
      const { key, value, path } = context;

      if (path[0] === "importers" && path.length === 4) {
        const importerPath = path[1];
        const packageName = key;
        const depInfo = value as { specifier: string; version: string };

        // The version field contains the actual instance ID
        const versionString = depInfo.version;

        // Check all instances of this package to see which one matches
        const packageInstances = packageGroups.get(packageName) || [];
        for (const instanceId of packageInstances) {
          // Match either exact instance ID or base version
          if (
            versionString === instanceId ||
            versionString.startsWith(instanceId + "(") ||
            instanceId === `${packageName}@${versionString}`
          ) {
            const instance = instancesMap.get(instanceId);
            if (instance) {
              instance.projects.add(importerPath || ".");
            }
          }
        }
      }
    });

    // Build duplicate instances
    const duplicates: DuplicateInstance[] = [];

    for (const [packageName, instanceIds] of packageGroups.entries()) {
      // Apply package filter if specified (with wildcard support)
      if (packageFilter && !matchesAnyWildcard(packageName, packageFilter)) {
        continue;
      }

      // Only include if there are multiple instances or showAll is true
      if (instanceIds.length > 1 || showAll) {
        const instances = instanceIds.map((id) => {
          const instance = instancesMap.get(id)!;

          // Use dependency tracker to get all importers (direct + transitive)
          let allImporters = this.dependencyTracker.getImportersForPackage(id);

          // Apply project filter if specified
          if (projectFilter) {
            allImporters = allImporters.filter((imp) =>
              projectFilter.includes(imp),
            );
          }

          // Generate dependency info for first project if requested
          let dependencyInfo = undefined;
          if (allImporters.length > 0) {
            // Use first project as representative for dependency path
            const firstProject = allImporters[0];
            if (firstProject) {
              dependencyInfo = this.getInstanceDependencyInfo(
                firstProject,
                packageName,
                instance.id,
              );
            }
          }

          return {
            id: instance.id,
            version: instance.version,
            dependencies: instance.dependencies,
            projects:
              allImporters.length > 0
                ? allImporters
                : Array.from(instance.projects),
            dependencyType: this.getDependencyType(packageName, allImporters),
            dependencyInfo,
          };
        });

        // Filter out instances that have no matching projects
        const filteredInstances = instances.filter(
          (inst) => inst.projects.length > 0,
        );

        // Only include if we have actual instances after filtering (and they are duplicates or showAll)
        if (
          filteredInstances.length > 0 &&
          (filteredInstances.length > 1 || showAll)
        ) {
          // Sort instances by ID for consistent output
          filteredInstances.sort((a, b) => a.id.localeCompare(b.id));

          duplicates.push({
            packageName,
            instances: filteredInstances,
          });
        }
      }
    }

    // Sort by package name
    duplicates.sort((a, b) => a.packageName.localeCompare(b.packageName));

    return duplicates;
  }

  /**
   * Find duplicates grouped by importer (reusing existing logic)
   */
  findPerProjectDuplicates(
    options: DuplicatesOptions = {},
  ): PerProjectDuplicate[] {
    const { projectFilter, maxDepth = 10 } = options;
    this.currentMaxDepth = maxDepth; // Set max depth for this operation

    // Get global duplicates first (with same filtering)
    const globalDuplicates = this.findDuplicates(options);

    // Group by importer
    const importerGroups = new Map<string, DuplicateInstance[]>();

    for (const duplicate of globalDuplicates) {
      for (const instance of duplicate.instances) {
        // For each project where this instance is used
        for (const project of instance.projects) {
          // Apply project filter if specified
          if (projectFilter && !projectFilter.includes(project)) {
            continue;
          }

          if (!importerGroups.has(project)) {
            importerGroups.set(project, []);
          }

          // Check if this package already exists in this importer's duplicates
          let existingPackage = importerGroups
            .get(project)!
            .find((pkg) => pkg.packageName === duplicate.packageName);

          if (!existingPackage) {
            existingPackage = {
              packageName: duplicate.packageName,
              instances: [],
            };
            importerGroups.get(project)!.push(existingPackage);
          }

          // Add this instance if not already present
          if (
            !existingPackage.instances.find((inst) => inst.id === instance.id)
          ) {
            existingPackage.instances.push(instance);
          }
        }
      }
    }

    // Convert to PerProjectDuplicate format and filter for actual duplicates
    const results: PerProjectDuplicate[] = [];

    for (const [importerPath, packages] of importerGroups.entries()) {
      const duplicatePackages = packages.filter(
        (pkg) => pkg.instances.length > 1 || options.showAll,
      );

      if (duplicatePackages.length > 0) {
        const filteredDuplicatePackages = duplicatePackages
          .map((pkg) => ({
            packageName: pkg.packageName,
            instances: pkg.instances.map((inst) => ({
              id: inst.id,
              version: inst.version,
              dependencies: inst.dependencies,
              dependencyInfo: this.getInstanceDependencyInfo(
                importerPath,
                pkg.packageName,
                inst.id,
              ),
            })),
          }))
          .filter((pkg) => {
            // Only omit the entire package if ALL instances should be omitted
            if (!options.omitTypes || options.omitTypes.length === 0) {
              return true; // No omit filter, keep all packages
            }

            // Check if all instances should be omitted
            const allInstancesShouldBeOmitted = pkg.instances.every((inst) =>
              this.shouldOmitDependencyType(
                inst.dependencyInfo.typeSummary,
                options.omitTypes,
              ),
            );

            return !allInstancesShouldBeOmitted; // Keep package if not all instances should be omitted
          })
          .filter((pkg) => pkg.instances.length > 1 || options.showAll); // Apply duplicate filter

        if (filteredDuplicatePackages.length > 0) {
          results.push({
            importerPath,
            duplicatePackages: filteredDuplicatePackages,
          });
        }
      }
    }

    return results.sort((a, b) => a.importerPath.localeCompare(b.importerPath));
  }

  /**
   * Determine the dependency type for a package instance across all importers
   */
  private getDependencyType(packageName: string, importers: string[]): string {
    // Check each importer to see how this package is included
    const types = new Set<string>();

    for (const importerPath of importers) {
      const importerData = this.lockfile.importers[importerPath];
      if (!importerData) continue;

      // Check direct dependencies
      if (importerData.dependencies?.[packageName]) {
        types.add("dependencies");
      } else if (importerData.devDependencies?.[packageName]) {
        types.add("devDependencies");
      } else if (importerData.optionalDependencies?.[packageName]) {
        types.add("optionalDependencies");
      } else if (importerData.peerDependencies?.[packageName]) {
        types.add("peerDependencies");
      } else {
        // It's transitive
        types.add("transitive");
      }
    }

    // Return the most specific type with priority: dependencies > optionalDependencies > peerDependencies > devDependencies
    if (types.has("dependencies")) return "dependencies";
    if (types.has("optionalDependencies")) return "optionalDependencies";
    if (types.has("peerDependencies")) return "peerDependencies";
    if (types.has("devDependencies")) return "devDependencies";
    return "transitive";
  }

  /**
   * Get complete dependency information for a specific instance of a package in an importer
   */
  private getInstanceDependencyInfo(
    importerPath: string,
    packageName: string,
    instanceId: string,
  ): DependencyInfo {
    // Try to build dependency path
    const path = this.buildDependencyPath(
      importerPath,
      packageName,
      instanceId,
    );

    if (path.length === 0) {
      // Fallback if we can't determine the path
      return {
        typeSummary: "transitive",
        path: [
          { package: instanceId, type: "transitive", specifier: "unknown" },
        ],
      };
    }

    // Determine type summary based on priority
    const typeSummary = this.getTypeSummaryFromPath(path);

    return {
      typeSummary,
      path,
    };
  }

  /**
   * Build the full dependency path from importer to target package
   */
  private buildDependencyPath(
    importerPath: string,
    packageName: string,
    instanceId: string,
  ): DependencyPathStep[] {
    const importerData = this.lockfile.importers[importerPath];
    if (!importerData) return [];

    // Check if it's a direct dependency first
    const directPath = this.checkDirectDependency(
      importerData,
      packageName,
      instanceId,
    );
    if (directPath) return directPath;

    // Check if it comes through linked dependencies
    const linkedPath = this.checkLinkedDependency(
      importerPath,
      packageName,
      instanceId,
    );
    if (linkedPath.length > 0) return linkedPath;

    // For transitive dependencies, we'll implement a simplified version for now
    // A full implementation would require traversing the actual dependency graph
    return this.buildTransitivePath(importerPath, packageName, instanceId);
  }

  /**
   * Check if package is a direct dependency and build single-step path
   */
  private checkDirectDependency(
    importerData: any,
    packageName: string,
    instanceId: string,
  ): DependencyPathStep[] | null {
    const depTypes = [
      { deps: importerData.dependencies, type: "dependencies" },
      { deps: importerData.optionalDependencies, type: "optionalDependencies" },
      { deps: importerData.peerDependencies, type: "peerDependencies" },
      { deps: importerData.devDependencies, type: "devDependencies" },
    ];

    for (const { deps, type } of depTypes) {
      if (deps?.[packageName]) {
        const depInfo = deps[packageName];
        const depVersion = depInfo.version;

        // Check if this specific instance matches
        if (
          depVersion === instanceId ||
          instanceId === `${packageName}@${depVersion}` ||
          depVersion.startsWith(instanceId + "(") ||
          instanceId.startsWith(`${packageName}@${depVersion}`)
        ) {
          return [
            {
              package: instanceId,
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
   * Check if package comes through linked dependencies and build path
   */
  private checkLinkedDependency(
    importerPath: string,
    packageName: string,
    instanceId: string,
  ): DependencyPathStep[] {
    const linkedDeps =
      this.dependencyTracker.getLinkedDependencies(importerPath);

    for (const linkedDep of linkedDeps) {
      const linkedImporterData =
        this.lockfile.importers[linkedDep.resolvedImporter];
      if (!linkedImporterData) continue;

      // Check if the target package exists in the linked dependency
      const linkedDirectPath = this.checkDirectDependency(
        linkedImporterData,
        packageName,
        instanceId,
      );
      if (linkedDirectPath) {
        // Build path: link step + target step
        // Find the actual specifier for the link
        const importerData = this.lockfile.importers[importerPath];
        let linkSpecifier = `link:${linkedDep.resolvedImporter}`;
        let linkType = "dependencies";

        // Find the actual link in the importer data
        const allDeps = {
          ...importerData?.dependencies,
          ...importerData?.devDependencies,
          ...importerData?.optionalDependencies,
          ...importerData?.peerDependencies,
        };

        if (allDeps?.[linkedDep.linkName]) {
          const linkInfo = allDeps[linkedDep.linkName];
          linkSpecifier = (linkInfo as any).specifier;

          // Determine link type
          if (importerData?.dependencies?.[linkedDep.linkName])
            linkType = "dependencies";
          else if (importerData?.devDependencies?.[linkedDep.linkName])
            linkType = "devDependencies";
          else if (importerData?.optionalDependencies?.[linkedDep.linkName])
            linkType = "optionalDependencies";
          else if (importerData?.peerDependencies?.[linkedDep.linkName])
            linkType = "peerDependencies";
        }

        const linkStep: DependencyPathStep = {
          package: linkedDep.linkName,
          type: linkType,
          specifier: linkSpecifier,
        };

        return [linkStep, ...linkedDirectPath];
      }
    }

    return [];
  }

  /**
   * Build transitive dependency path using cached DFS traversal
   */
  private buildTransitivePath(
    importerPath: string,
    _packageName: string,
    instanceId: string,
  ): DependencyPathStep[] {
    const importerData = this.lockfile.importers[importerPath];
    if (!importerData) return [];

    // Get all direct dependencies of this importer
    const allDirectDeps = [
      ...Object.entries(importerData.dependencies || {}).map(
        ([name, info]) => ({ name, info, type: "dependencies" }),
      ),
      ...Object.entries(importerData.devDependencies || {}).map(
        ([name, info]) => ({ name, info, type: "devDependencies" }),
      ),
      ...Object.entries(importerData.optionalDependencies || {}).map(
        ([name, info]) => ({ name, info, type: "optionalDependencies" }),
      ),
      ...Object.entries(importerData.peerDependencies || {}).map(
        ([name, info]) => ({ name, info, type: "peerDependencies" }),
      ),
    ];

    // Try to find actual dependency path for each direct dependency
    for (const { name, info, type } of allDirectDeps) {
      // Use proper snapshot ID construction
      const directDepId = `${name}@${info.version}`;

      // Quick filter: skip expensive DFS if package name doesn't suggest it could lead to target
      if (this.couldContainTarget(name, instanceId)) {
        // Use cached DFS to find path from this direct dependency to target
        const path = this.findDependencyPathDFS(directDepId, instanceId);
        if (path.length > 0) {
          // Prepend the direct dependency step
          const directStep: DependencyPathStep = {
            package: directDepId,
            type,
            specifier: info.specifier,
          };
          return [directStep, ...path];
        }
      }
    }

    // Fallback: just the target package
    return [{ package: instanceId, type: "transitive", specifier: "unknown" }];
  }

  /**
   * Quick filter to avoid expensive DFS on packages unlikely to contain the target
   */
  private couldContainTarget(
    packageName: string,
    targetInstanceId: string,
  ): boolean {
    const targetPkgName = parsePackageString(targetInstanceId).name;

    // If package name contains any part of the target name, it might contain it
    if (
      packageName.includes(targetPkgName) ||
      targetPkgName.includes(packageName)
    ) {
      return true;
    }

    // Known patterns that often contain typescript-eslint
    if (targetPkgName.includes("typescript-eslint")) {
      return (
        packageName.includes("eslint") ||
        packageName.includes("typescript") ||
        packageName.includes("@typescript-eslint")
      );
    }

    // For other packages, be more conservative - only check closely related names
    const targetParts = targetPkgName.split("/").pop()?.split("-") || [];
    const packageParts = packageName.split("/").pop()?.split("-") || [];

    return targetParts.some((part) => packageParts.includes(part));
  }

  /**
   * Find dependency path using cached forward DFS
   */
  private findDependencyPathDFS(
    fromPackageId: string,
    toPackageId: string,
  ): DependencyPathStep[] {
    // Check cache first
    const cacheKey = `${fromPackageId}->${toPackageId}`;
    if (this.pathCache.has(cacheKey)) {
      return this.pathCache.get(cacheKey)!;
    }

    // Perform DFS with depth limit and caching
    const result = this.dfsWithLimits(fromPackageId, toPackageId, new Set(), 0);

    // Cache the result (even if empty)
    this.pathCache.set(cacheKey, result);
    return result;
  }

  /**
   * DFS traversal with depth limit and cycle detection
   */
  private dfsWithLimits(
    startPackageId: string,
    targetPackageId: string,
    visited: Set<string>,
    depth: number,
  ): DependencyPathStep[] {
    // Depth limit to prevent exponential blowup
    if (depth > this.currentMaxDepth) return [];

    // Cycle detection
    if (visited.has(startPackageId)) return [];
    visited.add(startPackageId);

    // Found target
    if (startPackageId === targetPackageId) {
      return [];
    }

    // Get snapshot for current package
    let snapshotData = this.lockfile.snapshots?.[startPackageId];

    if (!snapshotData) {
      // Try to find by parsing the package ID
      const parsed = parsePackageString(startPackageId);
      const foundSnapshotId = this.findSnapshotId(
        parsed.name,
        parsed.version || "",
      );
      if (foundSnapshotId) {
        snapshotData = this.lockfile.snapshots?.[foundSnapshotId];
        startPackageId = foundSnapshotId;
      }
    }

    if (!snapshotData) return [];

    // Check dependencies by type to preserve type information
    const depTypes = [
      { deps: snapshotData.dependencies, type: "dependencies" },
      { deps: snapshotData.optionalDependencies, type: "optionalDependencies" },
      { deps: snapshotData.peerDependencies, type: "peerDependencies" },
      { deps: snapshotData.devDependencies, type: "devDependencies" },
    ];

    for (const { deps, type } of depTypes) {
      for (const [subDepName, subDepVersion] of Object.entries(deps || {})) {
        const subDepVersionStr = subDepVersion as string;
        const subDepId =
          this.findSnapshotId(subDepName, subDepVersionStr) ||
          `${subDepName}@${subDepVersionStr}`;

        // Check if this subdependency is our target
        if (subDepId === targetPackageId) {
          // Check if this dependency is actually a peer dependency in the package definition
          const actualType = this.getActualDependencyType(
            startPackageId,
            subDepName,
            type as string,
          );
          return [
            {
              package: targetPackageId,
              type: actualType,
              specifier: subDepVersionStr,
            },
          ];
        }

        // Recursively search deeper
        const deeperPath = this.dfsWithLimits(
          subDepId,
          targetPackageId,
          new Set(visited),
          depth + 1,
        );
        if (deeperPath.length > 0) {
          // Check actual dependency type for intermediate step too
          const actualType = this.getActualDependencyType(
            startPackageId,
            subDepName,
            type as string,
          );
          const intermediateStep: DependencyPathStep = {
            package: subDepId,
            type: actualType,
            specifier: subDepVersionStr,
          };
          return [intermediateStep, ...deeperPath];
        }
      }
    }

    return [];
  }

  /**
   * Get the actual dependency type by checking package definition for peer dependencies
   */
  private getActualDependencyType(
    packageId: string,
    depName: string,
    snapshotType: string,
  ): string {
    // Get the base package ID without peer dependency context
    const basePkgId = packageId.split("(")[0];

    // Check package definition for peer dependencies
    if (this.lockfile.packages && basePkgId) {
      const basePkg = this.lockfile.packages[basePkgId];
      if (basePkg?.peerDependencies?.[depName]) {
        // This is actually a peer dependency, even though snapshot shows it as regular
        return "peerDependencies";
      }

      // Also check packages with full peer context
      const fullPkg = this.lockfile.packages[packageId];
      if (fullPkg?.peerDependencies?.[depName]) {
        return "peerDependencies";
      }
    }

    // Fall back to snapshot type
    return snapshotType;
  }

  /**
   * Find snapshot ID using same logic as dependency tracker
   */
  private findSnapshotId(packageName: string, version: string): string | null {
    const exactMatch = `${packageName}@${version}`;
    if (this.lockfile.snapshots && this.lockfile.snapshots[exactMatch]) {
      return exactMatch;
    }

    for (const snapshotId of Object.keys(this.lockfile.snapshots || {})) {
      const parsed = parsePackageString(snapshotId);
      if (parsed.name === packageName && parsed.version === version) {
        return snapshotId;
      }
    }

    return null;
  }

  /**
   * Determine type summary based on path with priority rules
   */
  private getTypeSummaryFromPath(path: DependencyPathStep[]): string {
    const types = new Set(path.map((step) => step.type));

    // Apply priority: dependencies > optionalDependencies > peerDependencies > devDependencies
    if (types.has("dependencies")) return "dependencies";
    if (types.has("optionalDependencies")) return "optionalDependencies";
    if (types.has("peerDependencies")) return "peerDependencies";
    if (types.has("devDependencies")) return "devDependencies";
    return "transitive";
  }

  /**
   * Format per-project duplicate results
   */
  formatPerProjectResults(
    perProjectDuplicates: PerProjectDuplicate[],
    format: OutputFormat = "tree",
    showDependencyTree = false,
    _maxDepth = 10,
  ): string {
    if (format === "json") {
      // Create clean version without dependencies for JSON output
      const cleanPerProject = perProjectDuplicates.map((project) => ({
        importerPath: project.importerPath,
        duplicatePackages: project.duplicatePackages.map((pkg) => ({
          packageName: pkg.packageName,
          instances: pkg.instances.map((inst) => ({
            id: inst.id,
            version: inst.version,
            dependencyInfo: inst.dependencyInfo,
          })),
        })),
      }));
      return JSON.stringify(cleanPerProject, null, 2);
    }

    return formatPerProjectDuplicates(
      perProjectDuplicates,
      true,
      showDependencyTree,
    );
  }

  /**
   * Check if package names exist in the lockfile
   */
  packagesExist(packageNames: string[]): {
    existing: string[];
    missing: string[];
  } {
    return validatePackages(this.lockfile, packageNames);
  }

  /**
   * Format duplicate results
   */
  formatResults(
    duplicates: DuplicateInstance[],
    format: OutputFormat = "tree",
    showDependencyTree = false,
  ): string {
    if (format === "json") {
      // Create clean version without dependencies for JSON output
      const cleanDuplicates = duplicates.map((dup) => ({
        packageName: dup.packageName,
        instances: dup.instances.map((inst) => ({
          id: inst.id,
          version: inst.version,
          projects: inst.projects,
          dependencyType: inst.dependencyType,
        })),
      }));
      return JSON.stringify(cleanDuplicates, null, 2);
    }

    return formatDuplicates(duplicates, true, showDependencyTree);
  }
}
