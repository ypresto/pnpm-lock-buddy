import type { PnpmLockfile } from "./lockfile.js";
import { loadLockfile } from "./lockfile.js";
import { parsePackageString } from "./parser.js";
import type {
  DependencyPathStep,
  LinkedDependencyInfo,
  PackageDependencyInfo,
} from "./types.js";
import { buildDependenciesHierarchy } from "@pnpm/reviewing.dependencies-hierarchy";
import type { PackageNode } from "@pnpm/reviewing.dependencies-hierarchy";
import path from "path";

/**
 * Tracks transitive dependencies and provides lookup functionality
 * to find which importers ultimately use a given package
 */
export class DependencyTracker {
  private lockfilePath: string;
  private lockfileDir: string;
  private depth: number;
  private lockfile: PnpmLockfile | null = null;
  private dependencyTrees: Record<string, PackageNode[]> = {};
  private dependencyMap = new Map<string, PackageDependencyInfo>();
  private importerDependencies = new Map<string, Set<string>>(); // importer -> direct deps
  private importerCache = new Map<string, string[]>(); // packageId -> importers (cached)
  private linkedDependencies = new Map<string, LinkedDependencyInfo[]>(); // importer -> linked deps
  private initPromise: Promise<void> | null = null;

  constructor(lockfilePath: string, depth: number = 10) {
    this.lockfilePath = lockfilePath;
    this.lockfileDir = path.dirname(lockfilePath);
    this.depth = depth;
  }

  private getLockfile(): PnpmLockfile {
    if (!this.lockfile) {
      this.lockfile = loadLockfile(this.lockfilePath);
    }
    return this.lockfile;
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
  private async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      await this.buildTreesFromPnpm();

      this.buildDependencyMapFromTrees();

      this.buildImporterDependencies();
      this.buildDependencyMap();
      this.resolveTransitiveDependencies();
    })();

    return this.initPromise;
  }

  /**
   * Build dependency trees using pnpm's buildDependenciesHierarchy
   */
  private async buildTreesFromPnpm(): Promise<void> {
    try {
      // Let buildDependenciesHierarchy auto-detect all projects from lockfile
      const hierarchyResult = await buildDependenciesHierarchy(undefined, {
        depth: this.depth,
        lockfileDir: this.lockfileDir,
        virtualStoreDirMaxLength: 120,
      });

      this.dependencyTrees = {};

      console.log(`[DEBUG] hierarchyResult keys:`, Object.keys(hierarchyResult));

      for (const [projectDir, hierarchy] of Object.entries(hierarchyResult)) {
        const importerId = projectDir === this.lockfileDir ? "." : path.relative(this.lockfileDir, projectDir);

        console.log(`[DEBUG] Processing ${projectDir} -> ${importerId}`, {
          deps: hierarchy.dependencies?.length || 0,
          devDeps: hierarchy.devDependencies?.length || 0,
          optionalDeps: hierarchy.optionalDependencies?.length || 0
        });

        const allNodes: PackageNode[] = [
          ...(hierarchy.dependencies || []),
          ...(hierarchy.devDependencies || []),
          ...(hierarchy.optionalDependencies || []),
        ];

        this.dependencyTrees[importerId] = allNodes;
        console.log(`[DEBUG] Tree for ${importerId}: ${allNodes.length} nodes, first 3:`,
          allNodes.slice(0, 3).map(n => `${n.name}@${n.version}`));
      }

    } catch (error) {
      throw new Error(`buildDependenciesHierarchy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Build dependency map from pnpm's trees
   */
  private buildDependencyMapFromTrees(): void {
    this.dependencyMap = new Map();

    for (const [importerId, tree] of Object.entries(this.dependencyTrees)) {
      this.traverseTreeAndBuildMap(tree, importerId);
    }
  }

  /**
   * Traverse tree and build dependency map
   */
  private traverseTreeAndBuildMap(
    nodes: PackageNode[],
    importerId: string,
  ): void {
    for (const node of nodes) {
      const packageId = `${node.name}@${node.version}`;

      if (!this.dependencyMap.has(packageId)) {
        this.dependencyMap.set(packageId, {
          importers: new Set(),
          directDependents: new Set(),
        });
      }

      this.dependencyMap.get(packageId)!.importers.add(importerId);

      if (node.dependencies) {
        for (const child of node.dependencies) {
          const childId = `${child.name}@${child.version}`;
          if (!this.dependencyMap.has(childId)) {
            this.dependencyMap.set(childId, {
              importers: new Set(),
              directDependents: new Set(),
            });
          }
          this.dependencyMap.get(childId)!.directDependents.add(packageId);
        }

        this.traverseTreeAndBuildMap(node.dependencies, importerId);
      }
    }
  }

  /**
   * Collect direct dependencies for each importer (legacy - still needed for path tracing)
   */
  private buildImporterDependencies(): void {
    for (const [importerPath, importerData] of Object.entries(
      this.getLockfile().importers || {},
    )) {
      const deps = new Set<string>();

      const allDeps = {
        ...importerData.dependencies,
        ...importerData.devDependencies,
        ...importerData.optionalDependencies,
      };

      for (const [depName, depInfo] of Object.entries(allDeps || {})) {
        if (depInfo?.version?.startsWith("link:")) {
          const resolvedImporter = this.resolveLinkPath(
            importerPath,
            depInfo.version,
          );

          if (resolvedImporter && this.getLockfile().importers?.[resolvedImporter]) {
            if (!this.linkedDependencies.has(importerPath)) {
              this.linkedDependencies.set(importerPath, []);
            }
            this.linkedDependencies.get(importerPath)!.push({
              sourceImporter: importerPath,
              linkName: depName,
              resolvedImporter: resolvedImporter,
            });

            const originalLinkId = `${depName}@${depInfo.version}`;
            deps.add(originalLinkId);

            const simpleLinkId = `${depName}@link:${resolvedImporter}`;
            deps.add(simpleLinkId);

            const linkedImporterData =
              this.getLockfile().importers?.[resolvedImporter];
            if (linkedImporterData) {
              const linkedAllDeps = {
                ...linkedImporterData.dependencies,
                ...linkedImporterData.devDependencies,
                ...linkedImporterData.optionalDependencies,
              };

              for (const [linkedDepName, linkedDepInfo] of Object.entries(
                linkedAllDeps || {},
              )) {
                let snapshotId = linkedDepInfo.version;

                if (!this.getLockfile().snapshots?.[snapshotId]) {
                  const candidateId = `${linkedDepName}@${linkedDepInfo.version}`;
                  if (this.getLockfile().snapshots?.[candidateId]) {
                    snapshotId = candidateId;
                  }
                }

                deps.add(snapshotId);
              }
            }
          }
        } else {
          let snapshotId = depInfo.version;

          if (!this.getLockfile().snapshots?.[snapshotId]) {
            const candidateId = `${depName}@${depInfo.version}`;
            if (this.getLockfile().snapshots?.[candidateId]) {
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
   * Build reverse dependency map from snapshots (legacy - still needed for some lookups)
   */
  private buildDependencyMap(): void {
    for (const snapshotId of Object.keys(this.getLockfile().snapshots || {})) {
      if (!this.dependencyMap.has(snapshotId)) {
        this.dependencyMap.set(snapshotId, {
          importers: new Set(),
          directDependents: new Set(),
        });
      }
    }

    for (const [snapshotId, snapshotData] of Object.entries(
      this.getLockfile().snapshots || {},
    )) {
      const allDeps = {
        ...snapshotData.dependencies,
        ...snapshotData.optionalDependencies,
      };

      for (const [depName, depVersion] of Object.entries(allDeps || {})) {
        const depSnapshotId = this.findSnapshotId(depName, depVersion);
        if (depSnapshotId) {
          if (!this.dependencyMap.has(depSnapshotId)) {
            this.dependencyMap.set(depSnapshotId, {
              importers: new Set(),
              directDependents: new Set(),
            });
          }

          this.dependencyMap
            .get(depSnapshotId)!
            .directDependents.add(snapshotId);
        }
      }
    }
  }

  /**
   * Find snapshot ID for a package name and version (legacy helper)
   */
  private findSnapshotId(packageName: string, version: string): string | null {
    const exactMatch = `${packageName}@${version}`;
    if (this.getLockfile().snapshots?.[exactMatch]) {
      return exactMatch;
    }

    for (const snapshotId of Object.keys(this.getLockfile().snapshots || {})) {
      const parsed = parsePackageString(snapshotId);
      if (parsed.name === packageName && parsed.version === version) {
        return snapshotId;
      }
    }

    return null;
  }

  /**
   * Resolve transitive dependencies using DFS (legacy - still needed for path tracing)
   */
  private resolveTransitiveDependencies(): void {
    for (const [
      importerPath,
      directDeps,
    ] of this.importerDependencies.entries()) {
      const allTransitiveDeps = new Set<string>();

      const visited = new Set<string>();
      const stack = Array.from(directDeps);

      while (stack.length > 0) {
        const currentDep = stack.pop()!;
        if (visited.has(currentDep)) continue;

        visited.add(currentDep);
        allTransitiveDeps.add(currentDep);

        let snapshotData = this.getLockfile().snapshots?.[currentDep];

        if (!snapshotData) {
          const parsed = parsePackageString(currentDep);
          const foundSnapshotId = this.findSnapshotId(
            parsed.name,
            parsed.version || "",
          );
          if (foundSnapshotId) {
            snapshotData = this.getLockfile().snapshots?.[foundSnapshotId];
          }
        }

        if (snapshotData) {
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
  async getImportersForPackage(packageId: string): Promise<string[]> {
    await this.initialize();

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
  async getDirectDependentsForPackage(packageId: string): Promise<string[]> {
    await this.initialize();

    const depInfo = this.dependencyMap.get(packageId);
    if (!depInfo) {
      return [];
    }

    return Array.from(depInfo.directDependents).sort();
  }

  /**
   * Check if a package is used by any importer
   */
  async isPackageUsed(packageId: string): Promise<boolean> {
    await this.initialize();

    const depInfo = this.dependencyMap.get(packageId);
    return depInfo ? depInfo.importers.size > 0 : false;
  }

  /**
   * Get linked dependencies for a given importer
   */
  async getLinkedDependencies(importerPath: string): Promise<LinkedDependencyInfo[]> {
    await this.initialize();

    return this.linkedDependencies.get(importerPath) || [];
  }

  /**
   * Get importer data by path
   */
  getImporterData(importerPath: string): any {
    return this.getLockfile().importers?.[importerPath];
  }

  /**
   * Get all packages
   */
  getAllPackages(): Record<string, any> {
    return this.getLockfile().packages || {};
  }

  /**
   * Get all snapshots
   */
  getAllSnapshots(): Record<string, any> {
    return this.getLockfile().snapshots || {};
  }

  /**
   * Get package or snapshot data by ID
   */
  getPackageOrSnapshotData(packageId: string): any {
    return this.getLockfile().packages?.[packageId] || this.getLockfile().snapshots?.[packageId];
  }

  /**
   * Get dependency path from importer to package (hybrid: tree-based + legacy fallback)
   */
  async getDependencyPath(
    importerPath: string,
    packageId: string,
  ): Promise<DependencyPathStep[]> {
    await this.initialize();

    const tree = this.dependencyTrees[importerPath];
    console.log(`[DEBUG] getDependencyPath: ${importerPath} -> ${packageId}, tree size: ${tree?.length || 0}`);

    if (!tree) {
      throw new Error(`No dependency tree found for importer: ${importerPath}`);
    }

    const path = this.findPathInTree(tree, packageId, []);
    console.log(`[DEBUG] findPathInTree result:`, path ? `${path.length} steps` : 'null');

    if (!path) {
      // List first few packages in tree for debugging
      const treePackages = tree.slice(0, 5).map(n => `${n.name}@${n.version}`);
      console.log(`[DEBUG] Tree contains:`, treePackages);
      throw new Error(`Dependency path not found for package ${packageId} in importer ${importerPath}`);
    }

    return path;
  }

  /**
   * Find path to target package in tree
   */
  private findPathInTree(
    nodes: PackageNode[],
    targetPackageId: string,
    currentPath: DependencyPathStep[]
  ): DependencyPathStep[] | null {
    for (const node of nodes) {
      const nodeId = `${node.name}@${node.version}`;

      const step: DependencyPathStep = {
        package: nodeId,
        type: node.isPeer ? "peerDependencies" : node.dev ? "devDependencies" : node.optional ? "optionalDependencies" : "dependencies",
        specifier: node.version
      };

      const newPath = [...currentPath, step];

      const nameMatch = node.name === parsePackageString(targetPackageId).name;
      const exactMatch = nodeId === targetPackageId || nodeId.startsWith(targetPackageId);

      if (exactMatch || nameMatch) {
        return newPath;
      }

      if (node.dependencies) {
        const childPath = this.findPathInTree(node.dependencies, targetPackageId, newPath);
        if (childPath) return childPath;
      }
    }

    return null;
  }

  /**
   * Get all dependency paths from importer to package (hybrid: tree-based + fallback)
   */
  async getAllDependencyPaths(
    importerPath: string,
    packageId: string,
    _maxDepth: number = 10,
  ): Promise<DependencyPathStep[][]> {
    await this.initialize();

    const tree = this.dependencyTrees[importerPath];
    if (!tree) {
      throw new Error(`No dependency tree found for importer: ${importerPath}`);
    }

    const allPaths = this.findAllPathsInTree(tree, packageId, []);
    return allPaths;
  }

  /**
   * Find all paths to target package in tree
   */
  private findAllPathsInTree(
    nodes: PackageNode[],
    targetPackageId: string,
    currentPath: DependencyPathStep[]
  ): DependencyPathStep[][] {
    const paths: DependencyPathStep[][] = [];

    for (const node of nodes) {
      const nodeId = `${node.name}@${node.version}`;

      const step: DependencyPathStep = {
        package: nodeId,
        type: node.isPeer ? "peerDependencies" : node.dev ? "devDependencies" : node.optional ? "optionalDependencies" : "dependencies",
        specifier: node.version
      };

      const newPath = [...currentPath, step];

      const nameMatch = node.name === parsePackageString(targetPackageId).name;
      const exactMatch = nodeId === targetPackageId || nodeId.startsWith(targetPackageId);

      if (exactMatch || nameMatch) {
        paths.push(newPath);
      }

      if (node.dependencies) {
        const childPaths = this.findAllPathsInTree(node.dependencies, targetPackageId, newPath);
        paths.push(...childPaths);
      }
    }

    return paths;
  }
}
