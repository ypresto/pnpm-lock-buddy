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
import type { DependencyPathStep, DependencyInfo } from "../core/types.js";

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
  private lockfile: PnpmLockfile;

  constructor(lockfilePath: string, lockfile: PnpmLockfile, depth: number = 10) {
    this.dependencyTracker = new DependencyTracker(lockfilePath, depth);
    this.lockfile = lockfile;
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
   * Ensure all instances have complete dependency info
   */
  private async enrichInstancesWithDependencyInfo(
    duplicates: DuplicateInstance[],
    options: DuplicatesOptions
  ): Promise<DuplicateInstance[]> {
    return Promise.all(duplicates.map(async duplicate => ({
      ...duplicate,
      instances: await Promise.all(duplicate.instances.map(async instance => {
        // If dependency info is missing or incomplete, generate it
        if (!instance.dependencyInfo || !instance.dependencyInfo.path || instance.dependencyInfo.path.length === 0) {
          const firstProject = instance.projects[0];
          if (firstProject) {
            return {
              ...instance,
              dependencyInfo: await this.getInstanceDependencyInfo(
                firstProject,
                duplicate.packageName,
                instance.id,
                options.maxDepth || 10
              )
            };
          }
        }
        return instance;
      }))
    })));
  }

  /**
   * Detect file variant project key using multiple methods
   */
  private detectFileVariantProjectKey(
    instance: any,
    project: string,
    packageName: string
  ): string {
    // Method 1: Check dependency path
    const fileVariantFromPath = this.detectFromDependencyPath(instance.dependencyInfo);
    if (fileVariantFromPath) return fileVariantFromPath;
    
    // Method 2: Check instance ID patterns
    const fileVariantFromId = this.detectFromInstanceId(instance.id, project);
    if (fileVariantFromId) return fileVariantFromId;
    
    // Method 3: Direct lockfile analysis
    const fileVariantFromLockfile = this.detectFromLockfile(instance, project, packageName);
    if (fileVariantFromLockfile) return fileVariantFromLockfile;
    
    // Fallback: regular project
    return project;
  }

  /**
   * Detect file variant from dependency path
   */
  private detectFromDependencyPath(dependencyInfo: any): string | null {
    if (!dependencyInfo?.path) return null;
    
    const fileVariantStep = dependencyInfo.path.find((step: any) => 
      step.package.includes('@file:')
    );
    
    return fileVariantStep ? fileVariantStep.package : null;
  }

  /**
   * Detect file variant from instance ID patterns
   */
  private detectFromInstanceId(instanceId: string, _project: string): string | null {
    // If the instance ID itself contains file: reference
    if (instanceId.includes('@file:')) {
      return instanceId;
    }
    return null;
  }

  /**
   * Detect file variant from direct lockfile analysis
   */
  private detectFromLockfile(
    instance: any,
    project: string,
    packageName: string
  ): string | null {
    // Method 1: Check if this project uses packages with file: versions
    const importerData = this.dependencyTracker.getImporterData(project);
    if (importerData) {
      const allDeps = {
        ...importerData.dependencies,
        ...importerData.devDependencies,
        ...importerData.optionalDependencies,
      };

      // Look for dependencies that have file: versions
      for (const [depName, depInfo] of Object.entries(allDeps || {})) {
        // @ts-expect-error - depInfo type mismatch from importerData structure
        if (depInfo?.version?.startsWith('file:')) {
          // This is a file variant dependency
          // @ts-expect-error - depInfo.version exists at runtime
          const fileVariantId = `${depName}@${depInfo.version}`;
          
          // Check if this file variant contains our target package
          const fileVariantData = this.dependencyTracker.getPackageOrSnapshotData(fileVariantId);
          if (fileVariantData) {
            const fileVariantDeps = {
              ...fileVariantData.dependencies,
              ...fileVariantData.optionalDependencies
            };
            
            // Check if this file variant has the package we're looking for
            if (fileVariantDeps[packageName] === instance.id ||
                fileVariantDeps[packageName] === parsePackageString(instance.id).version) {
              return fileVariantId;
            }
          }
        }
      }
    }

    // Method 2: Check if this instance comes from a file variant of the current project itself
    // Look for file variants that match the pattern *@file:{project}
    const filePattern = `@file:${project}`;
    
    // Check packages section
    for (const [pkgKey, pkgData] of Object.entries(this.dependencyTracker.getAllPackages())) {
      if (pkgKey.includes(filePattern)) {
        const deps = { ...pkgData.dependencies, ...pkgData.optionalDependencies };
        if (deps[packageName] === instance.id || 
            deps[packageName] === parsePackageString(instance.id).version) {
          return pkgKey;
        }
      }
    }

    // Check snapshots section  
    for (const [snapKey, snapData] of Object.entries(this.dependencyTracker.getAllSnapshots())) {
      if (snapKey.includes(filePattern)) {
        const deps = { ...snapData.dependencies, ...snapData.optionalDependencies };
        if (deps[packageName] === instance.id ||
            deps[packageName] === parsePackageString(instance.id).version) {
          return snapKey;
        }
      }
    }

    return null;
  }


  /**
   * Find packages that have multiple instances with different dependencies
   */
  async findDuplicates(options: DuplicatesOptions = {}): Promise<DuplicateInstance[]> {
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
        if (depInfo?.version?.startsWith("link:")) {
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
            versionString?.startsWith(instanceId + "(") ||
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
        const instances = await Promise.all(instanceIds.map(async (id) => {
          const instance = instancesMap.get(id)!;

          // Use dependency tracker to get all importers (direct + transitive)
          let allImporters = await this.dependencyTracker.getImportersForPackage(id);

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
              dependencyInfo = await this.getInstanceDependencyInfo(
                firstProject,
                packageName,
                instance.id,
                options.maxDepth || 10,
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
        }));

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
  async findPerProjectDuplicates(
    options: DuplicatesOptions = {},
  ): Promise<PerProjectDuplicate[]> {
    const { projectFilter } = options;

    // Get global duplicates first (with same filtering)
    const globalDuplicates = await this.findDuplicates(options);

    // Phase 1: Ensure all instances have complete dependency info
    const enrichedDuplicates = await this.enrichInstancesWithDependencyInfo(globalDuplicates, options);

    // Phase 2: Group by importer with robust file variant detection
    const importerGroups = new Map<string, DuplicateInstance[]>();

    for (const duplicate of enrichedDuplicates) {
      for (const instance of duplicate.instances) {
        // For each project where this instance is used
        for (const project of instance.projects) {
          // Apply project filter if specified
          if (projectFilter && !projectFilter.includes(project)) {
            continue;
          }

          // Use robust multi-method file variant detection
          const projectKey = this.detectFileVariantProjectKey(
            instance,
            project,
            duplicate.packageName
          );

          if (!importerGroups.has(projectKey)) {
            importerGroups.set(projectKey, []);
          }

          // Check if this package already exists in this importer's duplicates
          let existingPackage = importerGroups
            .get(projectKey)!
            .find((pkg) => pkg.packageName === duplicate.packageName);

          if (!existingPackage) {
            existingPackage = {
              packageName: duplicate.packageName,
              instances: [],
            };
            importerGroups.get(projectKey)!.push(existingPackage);
          }

          // Add this instance if not already present
          if (
            !existingPackage.instances.find((inst) => inst.id === instance.id)
          ) {
            // For file variant entries, modify the dependency info to show clean direct dependency
            let modifiedInstance = instance;
            if (projectKey.includes('@file:')) {
              const fileVariantType = instance.dependencyInfo?.path.find(step =>
                step.package.includes('@file:')
              )?.type || 'dependencies';

              modifiedInstance = {
                ...instance,
                dependencyInfo: {
                  typeSummary: fileVariantType,
                  path: [{
                    package: instance.id,
                    type: fileVariantType,
                    specifier: instance.id
                  }],
                  allPaths: undefined // Clear to avoid complex tree
                }
              };
            }
            existingPackage.instances.push(modifiedInstance);
          }
        }
      }
    }

    // Phase 3: Convert to PerProjectDuplicate format and filter for actual duplicates
    const results: PerProjectDuplicate[] = [];

    for (const [importerPath, packages] of importerGroups.entries()) {
      // Within each project, group packages by name and check if any package has multiple versions
      const packagesByName = new Map<string, any[]>();
      
      for (const pkg of packages) {
        if (!packagesByName.has(pkg.packageName)) {
          packagesByName.set(pkg.packageName, []);
        }
        packagesByName.get(pkg.packageName)!.push(pkg);
      }

      const duplicatePackages: any[] = [];

      for (const [packageName, packageGroup] of packagesByName.entries()) {
        // Collect all instances across all package entries with the same name
        const allInstances: any[] = [];
        for (const pkg of packageGroup) {
          allInstances.push(...pkg.instances);
        }

        // Check if we have multiple versions (different instance IDs = potential duplicates)
        const uniqueVersions = new Set(allInstances.map(inst => {
          // Extract base version without peer deps
          const parsed = parsePackageString(inst.id);
          return parsed.version || inst.version;
        }));

        const isDuplicate = uniqueVersions.size > 1; // Multiple versions = duplicate

        if (isDuplicate || options.showAll) {
          const enrichedInstances = await Promise.all(allInstances.map(async (inst) => ({
            id: inst.id,
            version: inst.version,
            dependencies: inst.dependencies,
            dependencyInfo: inst.dependencyInfo || await this.getInstanceDependencyInfo(
              importerPath,
              packageName,
              inst.id,
              options.maxDepth || 10,
            ),
          })));

          duplicatePackages.push({
            packageName,
            instances: enrichedInstances,
          });
        }
      }

      // Apply omit types filter
      const filteredDuplicatePackages = duplicatePackages
        .map((pkg) => ({
          packageName: pkg.packageName,
          instances: pkg.instances.filter((inst: any) => {
            // Apply omit filter to individual instances
            if (!options.omitTypes || options.omitTypes.length === 0) {
              return true; // No omit filter, keep all instances
            }

            return !this.shouldOmitDependencyType(
              inst.dependencyInfo.typeSummary,
              options.omitTypes,
            );
          }),
        }))
        .filter((pkg) => pkg.instances.length > 0) // Remove packages with no instances after filtering
        .filter((pkg) => {
          // Check if this is still a duplicate after omit filtering
          const uniqueVersionsAfterOmit = new Set(pkg.instances.map((inst: any) => {
            const parsed = parsePackageString(inst.id);
            return parsed.version || inst.version;
          }));
          
          return uniqueVersionsAfterOmit.size > 1 || options.showAll;
        });

      if (filteredDuplicatePackages.length > 0) {
        results.push({
          importerPath,
          duplicatePackages: filteredDuplicatePackages,
        });
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
      const importerData = this.dependencyTracker.getImporterData(importerPath);
      if (!importerData) continue;

      // Check direct dependencies
      if (importerData.dependencies?.[packageName]) {
        types.add("dependencies");
      } else if (importerData.devDependencies?.[packageName]) {
        types.add("devDependencies");
      } else if (importerData.optionalDependencies?.[packageName]) {
        types.add("optionalDependencies");
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
  private async getInstanceDependencyInfo(
    importerPath: string,
    _packageName: string,
    instanceId: string,
    maxDepth: number = 10,
  ): Promise<DependencyInfo> {
    console.log(`[DEBUG] getInstanceDependencyInfo: ${importerPath} -> ${instanceId}`);
    const path = await this.dependencyTracker.getDependencyPath(
      importerPath,
      instanceId,
    );

    // Get all paths for diamond dependencies
    const allPaths = await this.dependencyTracker.getAllDependencyPaths(
      importerPath,
      instanceId,
      maxDepth,
    );

    const typeSummary =
      path.length > 0 ? this.getTypeSummaryFromPath(path) : "transitive";

    return {
      typeSummary,
      path:
        path.length > 0
          ? path
          : [{ package: instanceId, type: "transitive", specifier: "unknown" }],
      allPaths: allPaths.length > 1 ? allPaths : undefined, // Only include if multiple paths exist
    };
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
    compactTreeDepth?: number,
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
      compactTreeDepth,
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
    compactTreeDepth?: number,
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

    return formatDuplicates(
      duplicates, 
      true, 
      showDependencyTree, 
      compactTreeDepth,
    );
  }
}
