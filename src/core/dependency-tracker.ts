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
      this.buildLinkedDependencies();
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

      for (const [projectDir, hierarchy] of Object.entries(hierarchyResult)) {
        const importerId =
          projectDir === this.lockfileDir
            ? "."
            : path.relative(this.lockfileDir, projectDir);

        const allNodes: PackageNode[] = [
          ...(hierarchy.dependencies || []),
          ...(hierarchy.devDependencies || []),
          ...(hierarchy.optionalDependencies || []),
        ];

        this.dependencyTrees[importerId] = allNodes;
      }

      // Check if trees are empty (happens with mock lockfiles in tests)
      const totalNodes = Object.values(this.dependencyTrees).reduce(
        (sum, tree) => sum + tree.length,
        0,
      );
      if (totalNodes === 0) {
        this.buildTreesFromLockfile();
      }
    } catch (error) {
      // Fallback for tests without node_modules
      this.buildTreesFromLockfile();
    }
  }

  /**
   * Build dependency trees from lockfile data (fallback for tests)
   */
  private buildTreesFromLockfile(): void {
    const lockfile = this.getLockfile();
    this.dependencyTrees = {};

    for (const [importerId, importerData] of Object.entries(
      lockfile.importers || {},
    )) {
      const nodes: PackageNode[] = [];

      const allDeps = {
        ...importerData.dependencies,
        ...importerData.devDependencies,
        ...importerData.optionalDependencies,
      };

      for (const [depName, depInfo] of Object.entries(allDeps || {})) {
        const version = depInfo.version;
        const isDev = !!importerData.devDependencies?.[depName];
        const isOptional = !!importerData.optionalDependencies?.[depName];

        // Handle linked dependencies
        if (version.startsWith("link:")) {
          const resolvedImporter = this.resolveLinkPath(importerId, version);
          if (resolvedImporter && lockfile.importers?.[resolvedImporter]) {
            // Add dependencies from the linked importer
            const linkedImporterData = lockfile.importers[resolvedImporter];
            const linkedDeps = {
              ...linkedImporterData.dependencies,
              ...linkedImporterData.devDependencies,
              ...linkedImporterData.optionalDependencies,
            };

            for (const [linkedDepName, linkedDepInfo] of Object.entries(
              linkedDeps || {},
            )) {
              const linkedVersion = linkedDepInfo.version;
              const transitiveDeps = this.buildTransitiveDepsFromLockfile(
                linkedDepName,
                linkedVersion,
                lockfile,
                new Set(),
              );

              const node: PackageNode = {
                alias: linkedDepName,
                name: linkedDepName,
                version: linkedVersion,
                path: `node_modules/${linkedDepName}`,
                isPeer: false,
                isSkipped: false,
                isMissing: false,
                dependencies: transitiveDeps,
              };

              nodes.push(node);
            }
          }
          continue;
        }

        const transitiveDeps = this.buildTransitiveDepsFromLockfile(
          depName,
          version,
          lockfile,
          new Set(),
        );

        const node: PackageNode = {
          alias: depName,
          name: depName,
          version,
          path: `node_modules/${depName}`,
          isPeer: false,
          isSkipped: false,
          isMissing: false,
          dev: isDev,
          ...(isOptional && { optional: true }),
          dependencies: transitiveDeps,
        };

        nodes.push(node);
      }

      this.dependencyTrees[importerId] = nodes;
    }
  }

  /**
   * Build transitive dependencies from lockfile (fallback for tests)
   */
  private buildTransitiveDepsFromLockfile(
    packageName: string,
    packageVersion: string,
    lockfile: PnpmLockfile,
    visited: Set<string>,
  ): PackageNode[] | undefined {
    const packageId = `${packageName}@${packageVersion}`;
    if (visited.has(packageId)) return undefined;
    visited.add(packageId);

    const snapshotData = lockfile.snapshots?.[packageId];
    if (!snapshotData?.dependencies) return undefined;

    const childNodes: PackageNode[] = [];

    for (const [childName, childVersion] of Object.entries(
      snapshotData.dependencies,
    )) {
      const childNode: PackageNode = {
        alias: childName,
        name: childName,
        version: childVersion,
        path: `node_modules/${childName}`,
        isPeer: false,
        isSkipped: false,
        isMissing: false,
        dependencies: this.buildTransitiveDepsFromLockfile(
          childName,
          childVersion,
          lockfile,
          visited,
        ),
      };

      childNodes.push(childNode);
    }

    return childNodes.length > 0 ? childNodes : undefined;
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
   * Track linked dependencies for each importer
   */
  private buildLinkedDependencies(): void {
    for (const [importerPath, importerData] of Object.entries(
      this.getLockfile().importers || {},
    )) {
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

          if (
            resolvedImporter &&
            this.getLockfile().importers?.[resolvedImporter]
          ) {
            if (!this.linkedDependencies.has(importerPath)) {
              this.linkedDependencies.set(importerPath, []);
            }
            this.linkedDependencies.get(importerPath)!.push({
              sourceImporter: importerPath,
              linkName: depName,
              resolvedImporter: resolvedImporter,
            });
          }
        }
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
  async getLinkedDependencies(
    importerPath: string,
  ): Promise<LinkedDependencyInfo[]> {
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
    return (
      this.getLockfile().packages?.[packageId] ||
      this.getLockfile().snapshots?.[packageId]
    );
  }

  /**
   * Get dependency trees for all importers (after initialization)
   */
  async getDependencyTrees(): Promise<Record<string, PackageNode[]>> {
    await this.initialize();
    return this.dependencyTrees;
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

    if (!tree) {
      throw new Error(`No dependency tree found for importer: ${importerPath}`);
    }

    const path = this.findPathInTree(tree, packageId, []);

    if (!path) {
      throw new Error(
        `Dependency path not found for package ${packageId} in importer ${importerPath}`,
      );
    }

    return path;
  }

  /**
   * Find path to target package in tree
   */
  private findPathInTree(
    nodes: PackageNode[],
    targetPackageId: string,
    currentPath: DependencyPathStep[],
  ): DependencyPathStep[] | null {
    for (const node of nodes) {
      const nodeId = `${node.name}@${node.version}`;

      const step: DependencyPathStep = {
        package: nodeId,
        type: node.isPeer
          ? "peerDependencies"
          : node.dev
            ? "devDependencies"
            : node.optional
              ? "optionalDependencies"
              : "dependencies",
        specifier: node.version,
      };

      const newPath = [...currentPath, step];

      const nameMatch = node.name === parsePackageString(targetPackageId).name;
      const exactMatch =
        nodeId === targetPackageId || nodeId.startsWith(targetPackageId);

      if (exactMatch || nameMatch) {
        return newPath;
      }

      if (node.dependencies) {
        const childPath = this.findPathInTree(
          node.dependencies,
          targetPackageId,
          newPath,
        );
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
    currentPath: DependencyPathStep[],
  ): DependencyPathStep[][] {
    const paths: DependencyPathStep[][] = [];

    for (const node of nodes) {
      const nodeId = `${node.name}@${node.version}`;

      const step: DependencyPathStep = {
        package: nodeId,
        type: node.isPeer
          ? "peerDependencies"
          : node.dev
            ? "devDependencies"
            : node.optional
              ? "optionalDependencies"
              : "dependencies",
        specifier: node.version,
      };

      const newPath = [...currentPath, step];

      const nameMatch = node.name === parsePackageString(targetPackageId).name;
      const exactMatch =
        nodeId === targetPackageId || nodeId.startsWith(targetPackageId);

      if (exactMatch || nameMatch) {
        paths.push(newPath);
      }

      if (node.dependencies) {
        const childPaths = this.findAllPathsInTree(
          node.dependencies,
          targetPackageId,
          newPath,
        );
        paths.push(...childPaths);
      }
    }

    return paths;
  }
}
