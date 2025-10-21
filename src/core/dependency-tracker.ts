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
   * - link:packages/webapp/bakuraku-fetch from anywhere → packages/webapp/bakuraku-fetch (absolute)
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

    // If path doesn't start with ../ or ./, it's an absolute path from workspace root
    if (!relativePath.startsWith("../") && !relativePath.startsWith("./")) {
      return relativePath;
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
      // Don't build dependency map yet - do it lazily when needed
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
      } else {
        // Post-process pnpm trees to add missing linked workspace dependencies
        this.enrichTreesWithLinkedWorkspaceDeps();
      }
    } catch (error) {
      // Fallback for tests without node_modules
      this.buildTreesFromLockfile();
    }
  }

  /**
   * Post-process trees built by pnpm to add dependencies from linked workspace packages
   * that may not be fully tracked in the filesystem-based tree
   */
  private enrichTreesWithLinkedWorkspaceDeps(): void {
    const lockfile = this.getLockfile();
    // Use a global visited set to prevent infinite recursion across all trees
    const globalVisited = new Set<string>();

    for (const nodes of Object.values(this.dependencyTrees)) {
      this.enrichNodesWithLinkedDeps(nodes, lockfile, globalVisited);
    }
  }

  /**
   * Recursively enrich nodes with dependencies from linked workspace packages
   */
  private enrichNodesWithLinkedDeps(
    nodes: PackageNode[],
    lockfile: PnpmLockfile,
    visitedImporters: Set<string>,
    visitedNodes: Set<PackageNode> = new Set(),
  ): void {
    for (const node of nodes) {
      // Prevent re-processing the same node
      if (visitedNodes.has(node)) {
        continue;
      }
      visitedNodes.add(node);

      // Check if this is a workspace package (file: version)
      if (node.version.startsWith("file:")) {
        const snapshotKey = `${node.name}@${node.version}`;
        const snapshot = lockfile.snapshots?.[snapshotKey];

        if (!snapshot) {
          console.warn(
            `Warning: Missing snapshot for workspace package ${snapshotKey}`,
          );
        }

        if (snapshot) {
          // Check for link: dependencies in the snapshot
          const allSnapshotDeps = {
            ...snapshot.dependencies,
            ...snapshot.optionalDependencies,
          };

          for (const [depName, depVersion] of Object.entries(
            allSnapshotDeps || {},
          )) {
            if (
              typeof depVersion === "string" &&
              depVersion.startsWith("link:")
            ) {
              // Check if this link is already in the node's dependencies
              const existingChild = node.dependencies?.find(
                (child) => child.name === depName,
              );

              // Enrich the link if it's missing OR if it exists but has no dependencies
              if (!existingChild || !existingChild.dependencies) {
                // Link is missing or incomplete - try to resolve it
                const sourceImporter = this.extractImporterPathFromFileVersion(
                  node.version,
                );
                const resolvedImporter = sourceImporter
                  ? this.resolveLinkPath(sourceImporter, depVersion)
                  : null;

                if (
                  resolvedImporter &&
                  lockfile.importers?.[resolvedImporter] &&
                  !visitedImporters.has(resolvedImporter)
                ) {
                  // Always use standalone importer for links to detect runtime conflicts
                  // Even if a contextualized snapshot exists, the filesystem link resolves
                  // to the standalone workspace directory
                  const linkDeps = this.buildLinkedDependencyNodes(
                    resolvedImporter,
                    lockfile,
                    visitedImporters,
                  );

                  if (existingChild) {
                    // Enrich existing node
                    existingChild.dependencies =
                      linkDeps.length > 0 ? linkDeps : undefined;
                  } else {
                    // Create new link node
                    const linkNode: PackageNode = {
                      alias: depName,
                      name: depName,
                      version: depVersion,
                      path: `node_modules/${depName}`,
                      isPeer: false,
                      isSkipped: false,
                      isMissing: false,
                      dependencies: linkDeps.length > 0 ? linkDeps : undefined,
                    };

                    if (!node.dependencies) {
                      node.dependencies = [];
                    }
                    node.dependencies.push(linkNode);
                  }
                } else if (
                  !resolvedImporter ||
                  !lockfile.importers?.[resolvedImporter]
                ) {
                  console.warn(
                    `Warning: Cannot resolve link ${depName}=${depVersion} from ${sourceImporter}`,
                  );
                }
              }
            }
          }
        }
      }

      // Recursively process children
      if (node.dependencies) {
        this.enrichNodesWithLinkedDeps(
          node.dependencies,
          lockfile,
          visitedImporters,
          visitedNodes,
        );
      }
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
            // Recursively collect all dependencies from linked importers
            const linkedNodes = this.buildLinkedDependencyNodes(
              resolvedImporter,
              lockfile,
              new Set([importerId]),
            );
            nodes.push(...linkedNodes);
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
   * Recursively build dependency nodes from linked importers
   * Handles nested workspace links to ensure all transitive dependencies are tracked
   */
  private buildLinkedDependencyNodes(
    importerId: string,
    lockfile: PnpmLockfile,
    visitedImporters: Set<string>,
  ): PackageNode[] {
    // Prevent infinite recursion on circular workspace links
    if (visitedImporters.has(importerId)) {
      return [];
    }
    visitedImporters.add(importerId);

    const nodes: PackageNode[] = [];
    const importerData = lockfile.importers?.[importerId];
    if (!importerData) return nodes;

    const allDeps = {
      ...importerData.dependencies,
      ...importerData.devDependencies,
      ...importerData.optionalDependencies,
    };

    for (const [depName, depInfo] of Object.entries(allDeps || {})) {
      const version = depInfo.version;

      // Recursively handle nested linked dependencies
      if (version.startsWith("link:")) {
        const resolvedImporter = this.resolveLinkPath(importerId, version);
        if (resolvedImporter && lockfile.importers?.[resolvedImporter]) {
          const nestedNodes = this.buildLinkedDependencyNodes(
            resolvedImporter,
            lockfile,
            new Set(visitedImporters),
          );
          nodes.push(...nestedNodes);
        }
        continue;
      }

      // Build regular dependency node with transitive dependencies
      const transitiveDeps = this.buildTransitiveDepsFromLockfile(
        depName,
        version,
        lockfile,
        new Set(),
        visitedImporters,
      );

      const node: PackageNode = {
        alias: depName,
        name: depName,
        version: version,
        path: `node_modules/${depName}`,
        isPeer: false,
        isSkipped: false,
        isMissing: false,
        dependencies: transitiveDeps,
      };

      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Build transitive dependencies from lockfile (fallback for tests)
   */
  private buildTransitiveDepsFromLockfile(
    packageName: string,
    packageVersion: string,
    lockfile: PnpmLockfile,
    visited: Set<string>,
    visitedImporters?: Set<string>,
  ): PackageNode[] | undefined {
    const packageId = `${packageName}@${packageVersion}`;
    if (visited.has(packageId)) return undefined;
    visited.add(packageId);

    const snapshotData = lockfile.snapshots?.[packageId];
    if (!snapshotData) return undefined;

    const childNodes: PackageNode[] = [];

    // Process all types of dependencies from snapshot (dependencies and optionalDependencies)
    const allSnapshotDeps = {
      ...snapshotData.dependencies,
      ...snapshotData.optionalDependencies,
    };

    for (const [childName, childVersion] of Object.entries(
      allSnapshotDeps || {},
    )) {
      // Ensure version is a string
      const versionStr =
        typeof childVersion === "string" ? childVersion : String(childVersion);

      // Handle link: dependencies in snapshots - create a node for the linked package
      if (versionStr.startsWith("link:")) {
        const sourceImporter =
          this.extractImporterPathFromFileVersion(packageVersion) || ".";
        const resolvedImporter = this.resolveLinkPath(
          sourceImporter,
          versionStr,
        );

        if (resolvedImporter && lockfile.importers?.[resolvedImporter]) {
          // Use standalone importer to track dependencies from linked workspace package
          const linkedDeps =
            !visitedImporters || !visitedImporters.has(resolvedImporter)
              ? this.buildLinkedDependencyNodes(
                  resolvedImporter,
                  lockfile,
                  visitedImporters || new Set(),
                )
              : [];

          const linkNode: PackageNode = {
            alias: childName,
            name: childName,
            version: versionStr,
            path: `node_modules/${childName}`,
            isPeer: false,
            isSkipped: false,
            isMissing: false,
            dependencies: linkedDeps.length > 0 ? linkedDeps : undefined,
          };

          childNodes.push(linkNode);
        }
        continue;
      }

      const childNode: PackageNode = {
        alias: childName,
        name: childName,
        version: versionStr,
        path: `node_modules/${childName}`,
        isPeer: false,
        isSkipped: false,
        isMissing: false,
        dependencies: this.buildTransitiveDepsFromLockfile(
          childName,
          versionStr,
          lockfile,
          visited,
          visitedImporters,
        ),
      };

      childNodes.push(childNode);
    }

    // For injected workspace packages (file:), also include linked dependencies from the workspace importer
    if (packageVersion.startsWith("file:")) {
      const rawPath = this.extractImporterPathFromFileVersion(packageVersion);
      // The file: path might be relative - need to find the actual importer key
      const importerPath = rawPath
        ? this.findImporterByFilePath(rawPath, lockfile)
        : null;

      if (
        importerPath &&
        lockfile.importers?.[importerPath] &&
        (!visitedImporters || !visitedImporters.has(importerPath))
      ) {
        const linkedNodes = this.buildLinkedDependencyNodes(
          importerPath,
          lockfile,
          visitedImporters || new Set(),
        );
        childNodes.push(...linkedNodes);
      }
    }

    return childNodes.length > 0 ? childNodes : undefined;
  }

  /**
   * Extract importer path from file: version string
   * E.g., "file:packages/webapp/ui-react(...)" -> "packages/webapp/ui-react"
   */
  private extractImporterPathFromFileVersion(version: string): string | null {
    const match = version.match(/^file:([^(]+)/);
    return match?.[1] ?? null;
  }

  /**
   * Find the actual importer key by matching file path
   * file: paths are relative to lockfileDir (workspace root)
   * Use path.posix for standard path resolution (lockfiles always use forward slashes)
   */
  private findImporterByFilePath(
    filePath: string,
    lockfile: PnpmLockfile,
  ): string | null {
    // Direct match (most common case)
    if (lockfile.importers?.[filePath]) {
      return filePath;
    }

    // Resolve path from workspace root using path.posix
    // Since file: paths are relative to workspace root, resolve from root
    const resolvedPath = path.posix.normalize(filePath);

    // Strip leading ../ segments (can't go above workspace root)
    const cleanPath = resolvedPath.replace(/^(?:\.\.\/)+/, "");

    // Also try with ./ removed
    const withoutDotSlash = cleanPath.replace(/^\.\//, "");

    if (lockfile.importers?.[cleanPath]) {
      return cleanPath;
    }

    if (lockfile.importers?.[withoutDotSlash]) {
      return withoutDotSlash;
    }

    return null;
  }

  /**
   * Build dependency map from pnpm's trees (lazy - only when needed)
   */
  private buildDependencyMapFromTrees(): void {
    if (this.dependencyMap.size > 0) {
      return; // Already built
    }

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

    // Build dependency map lazily
    if (this.dependencyMap.size === 0) {
      this.buildDependencyMapFromTrees();
    }

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

    // Build dependency map lazily
    if (this.dependencyMap.size === 0) {
      this.buildDependencyMapFromTrees();
    }

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

    // Build dependency map lazily
    if (this.dependencyMap.size === 0) {
      this.buildDependencyMapFromTrees();
    }

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

    const path = this.findPathInTree(tree, packageId, [], new Set(), 0);

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
    visitedNodeIds: Set<string>,
    depth: number,
  ): DependencyPathStep[] | null {
    // Depth limit to prevent stack overflow even with cycles
    if (depth > 100) {
      return null;
    }
    for (const node of nodes) {
      const nodeId = `${node.name}@${node.version}`;

      // Prevent infinite recursion from circular dependencies in current path
      if (visitedNodeIds.has(nodeId)) {
        continue;
      }

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
        // Add nodeId to visited for this path
        visitedNodeIds.add(nodeId);

        const childPath = this.findPathInTree(
          node.dependencies,
          targetPackageId,
          newPath,
          visitedNodeIds,
          depth + 1,
        );

        if (childPath) {
          // Don't delete - keep in visited to prevent cycles
          return childPath;
        }

        // Remove after exploring this branch
        visitedNodeIds.delete(nodeId);
      }
    }

    return null;
  }

  /**
   * Get all dependency paths from importer to package (hybrid: tree-based + fallback)
   * Circular dependencies are detected and marked in paths
   */
  async getAllDependencyPaths(
    importerPath: string,
    packageId: string,
  ): Promise<DependencyPathStep[][]> {
    await this.initialize();

    const tree = this.dependencyTrees[importerPath];
    if (!tree) {
      throw new Error(`No dependency tree found for importer: ${importerPath}`);
    }

    const paths: DependencyPathStep[][] = [];
    this.findAllPathsInTree(tree, packageId, [], new Set(), 0, paths);
    return paths;
  }

  /**
   * Find all paths to target package in tree
   * Detects and marks circular dependencies by tracking node IDs in current path
   */
  private findAllPathsInTree(
    nodes: PackageNode[],
    targetPackageId: string,
    currentPath: DependencyPathStep[],
    visitedNodeIds: Set<string>,
    depth: number,
    paths: DependencyPathStep[][],
  ): void {
    // Depth limit to prevent stack overflow
    if (depth > 100) {
      return;
    }

    for (const node of nodes) {
      const nodeId = `${node.name}@${node.version}`;

      // Check if this node ID creates a circular dependency in current path
      if (visitedNodeIds.has(nodeId)) {
        // Skip this path - circular dependency that doesn't lead to target
        continue;
      }

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
        // Add nodeId to visited for this path branch
        visitedNodeIds.add(nodeId);

        this.findAllPathsInTree(
          node.dependencies,
          targetPackageId,
          newPath,
          visitedNodeIds,
          depth + 1,
          paths,
        );

        // Remove after exploring this branch to allow node in other paths
        visitedNodeIds.delete(nodeId);
      }
    }
  }
}
