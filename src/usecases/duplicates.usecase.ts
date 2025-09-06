import type { PnpmLockfile } from "../core/lockfile.js";
import { parsePackageString } from "../core/parser.js";
import { traverseLockfile } from "../core/traverser.js";
import { validatePackages } from "../core/utils.js";
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

export interface ProjectPackageDuplicate {
  packageName: string;
  instances: Array<{
    id: string;
    version: string;
    dependencies: Record<string, string>;
    dependencyPath: string;
  }>;
}

export class DuplicatesUsecase {
  private dependencyTracker: DependencyTracker;

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
      // Apply package filter if specified
      if (packageFilter && !packageFilter.includes(packageName)) {
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

          return {
            id: instance.id,
            version: instance.version,
            dependencies: instance.dependencies,
            projects:
              allImporters.length > 0
                ? allImporters
                : Array.from(instance.projects),
            dependencyType: this.getDependencyType(packageName, allImporters),
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
    const { projectFilter } = options;

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
              dependencyPath: this.getInstanceDependencyType(
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
                inst.dependencyPath,
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
   * Get dependency type for a specific instance of a package in an importer
   */
  private getInstanceDependencyType(
    importerPath: string,
    packageName: string,
    instanceId: string,
  ): string {
    const importerData = this.lockfile.importers[importerPath];
    if (!importerData) return "unknown";

    // Check all dependency types to see which one matches this specific instance
    const allDeps = {
      ...importerData.dependencies,
      ...importerData.devDependencies,
      ...importerData.optionalDependencies,
      ...importerData.peerDependencies,
    };

    // Find the dependency entry that matches this instance
    for (const [depName, depInfo] of Object.entries(allDeps)) {
      if (depName === packageName) {
        const depVersion = (depInfo as { version: string }).version;
        // Check if this specific instance ID matches the version
        if (
          depVersion === instanceId ||
          instanceId === `${packageName}@${depVersion}` ||
          depVersion.startsWith(instanceId + "(") ||
          instanceId.startsWith(`${packageName}@${depVersion}`)
        ) {
          // Determine the dependency type with correct priority
          if (importerData.dependencies?.[packageName]) {
            return "dependencies";
          } else if (importerData.optionalDependencies?.[packageName]) {
            return "optionalDependencies";
          } else if (importerData.peerDependencies?.[packageName]) {
            return "peerDependencies";
          } else if (importerData.devDependencies?.[packageName]) {
            return "devDependencies";
          }
        }
      }
    }

    // Check if this package comes through linked dependencies
    const linkedDeps =
      this.dependencyTracker.getLinkedDependencies(importerPath);
    for (const linkedDep of linkedDeps) {
      const linkedImporterData =
        this.lockfile.importers[linkedDep.resolvedImporter];
      if (linkedImporterData) {
        const allLinkedDeps = {
          ...linkedImporterData.dependencies,
          ...linkedImporterData.devDependencies,
          ...linkedImporterData.optionalDependencies,
          ...linkedImporterData.peerDependencies,
        };

        // Check if this specific instance is from the linked dependency
        for (const [linkedDepName, linkedDepInfo] of Object.entries(
          allLinkedDeps,
        )) {
          if (linkedDepName === packageName) {
            const linkedDepVersion = (linkedDepInfo as { version: string })
              .version;
            if (
              linkedDepVersion === instanceId ||
              instanceId === `${packageName}@${linkedDepVersion}` ||
              linkedDepVersion.startsWith(instanceId + "(") ||
              instanceId.startsWith(`${packageName}@${linkedDepVersion}`)
            ) {
              // Determine the original type in the linked package with correct priority
              if (linkedImporterData.dependencies?.[packageName]) {
                return "dependencies, transitive via linked";
              } else if (
                linkedImporterData.optionalDependencies?.[packageName]
              ) {
                return "optionalDependencies, transitive via linked";
              } else if (linkedImporterData.peerDependencies?.[packageName]) {
                return "peerDependencies, transitive via linked";
              } else if (linkedImporterData.devDependencies?.[packageName]) {
                return "devDependencies, transitive via linked";
              }
              return "dependencies, transitive via linked"; // fallback
            }
          }
        }
      }
    }

    // If not direct or linked, it's transitive - determine the path type
    return this.getTransitiveDependencyType(
      importerPath,
      packageName,
      instanceId,
    );
  }

  /**
   * Get the dependency type for transitive dependencies by tracing the path
   */
  private getTransitiveDependencyType(
    importerPath: string,
    packageName: string,
    instanceId: string,
  ): string {
    // Find all direct dependencies in this importer
    const importerData = this.lockfile.importers[importerPath];
    if (!importerData) return "transitive";

    const pathTypes = new Set<string>();

    // Check all direct dependencies to see which ones lead to this transitive dependency
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

    // Also check linked dependencies
    const linkedDeps =
      this.dependencyTracker.getLinkedDependencies(importerPath);
    for (const linkedDep of linkedDeps) {
      const linkedImporterData =
        this.lockfile.importers[linkedDep.resolvedImporter];
      if (linkedImporterData) {
        allDirectDeps.push(
          ...Object.entries(linkedImporterData.dependencies || {}).map(
            ([name, info]) => ({ name, info, type: "dependencies" }),
          ),
          ...Object.entries(linkedImporterData.devDependencies || {}).map(
            ([name, info]) => ({ name, info, type: "devDependencies" }),
          ),
          ...Object.entries(linkedImporterData.optionalDependencies || {}).map(
            ([name, info]) => ({ name, info, type: "optionalDependencies" }),
          ),
          ...Object.entries(linkedImporterData.peerDependencies || {}).map(
            ([name, info]) => ({ name, info, type: "peerDependencies" }),
          ),
        );
      }
    }

    // For each direct dependency, check if it leads to our target package
    for (const {
      name: directDepName,
      info: directDepInfo,
      type: directDepType,
    } of allDirectDeps) {
      const directDepVersion = (directDepInfo as { version: string }).version;
      if (
        this.dependencyLeadsToPackage(
          directDepName,
          directDepVersion,
          packageName,
          instanceId,
        )
      ) {
        pathTypes.add(directDepType);
      }
    }

    // Apply priority: dependencies > optionalDependencies > peerDependencies > devDependencies
    if (pathTypes.has("dependencies")) return "dependencies, transitive";
    if (pathTypes.has("optionalDependencies"))
      return "optionalDependencies, transitive";
    if (pathTypes.has("peerDependencies"))
      return "peerDependencies, transitive";
    if (pathTypes.has("devDependencies")) return "devDependencies, transitive";

    return "transitive";
  }

  /**
   * Check if a direct dependency leads to a target package through its dependency tree
   */
  private dependencyLeadsToPackage(
    directDepName: string,
    directDepVersion: string,
    _targetPackageName: string,
    targetInstanceId: string,
  ): boolean {
    // Simple implementation: check if the target package is in the importers that use this direct dependency
    const directDepId = directDepVersion.includes("@")
      ? directDepVersion
      : `${directDepName}@${directDepVersion}`;

    // Use dependency tracker to see if both packages are used by the same importers
    // This is a simplified approach - a full implementation would traverse the actual dependency graph
    const directDepImporters =
      this.dependencyTracker.getImportersForPackage(directDepId);
    const targetImporters =
      this.dependencyTracker.getImportersForPackage(targetInstanceId);

    // If they share importers, there's likely a dependency relationship
    return directDepImporters.some((importer) =>
      targetImporters.includes(importer),
    );
  }

  /**
   * Format per-project duplicate results
   */
  formatPerProjectResults(
    perProjectDuplicates: PerProjectDuplicate[],
    format: OutputFormat = "tree",
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
            dependencyPath: inst.dependencyPath,
          })),
        })),
      }));
      return JSON.stringify(cleanPerProject, null, 2);
    }

    return formatPerProjectDuplicates(perProjectDuplicates);
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

    return formatDuplicates(duplicates);
  }
}
