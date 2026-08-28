import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import type { PnpmLockfile } from "../../src/core/lockfile";
import type { PackageNode } from "@pnpm/reviewing.dependencies-hierarchy";

/**
 * Shape of the synthetic workspace used for tree-build benchmarks.
 *
 * The workspace link graph is a layered DAG:
 *
 *   .            -> l0p0, l0p1, ...      (width links)
 *   l{i}p{j}     -> l{i+1}p0, l{i+1}p1, ...  (width links each)
 *   l{last}p{j}  -> (no links)
 *
 * Every workspace package additionally depends on the head of a shared npm
 * dependency chain (lib0 -> lib1 -> ... -> lib{chainLength-1}).
 *
 * This is the diamond shape that makes per-path `visited` copies rebuild the
 * same subtree once per distinct path: the number of root-to-leaf paths is
 * width^layers, while the number of distinct importers is only layers*width+1.
 */
export interface SyntheticWorkspaceOptions {
  /** Depth of the workspace link graph. */
  layers: number;
  /** Number of workspace packages per layer. */
  width: number;
  /** Length of the npm dependency chain each workspace package pulls in. */
  chainLength: number;
  /**
   * Where the links to the next layer are declared.
   * "dev" mirrors the real-world shape (shared eslint-config / tsconfig /
   * test-utils are almost always devDependencies).
   */
  linkKind?: "dev" | "prod";
}

export interface SyntheticWorkspace {
  lockfile: PnpmLockfile;
  /** Number of importers in the lockfile (workspace packages + root). */
  importerCount: number;
  /** Number of distinct npm packages in the lockfile. */
  packageCount: number;
  /** Root-to-leaf path count through the link graph (the blow-up factor). */
  linkPathCount: number;
}

function importerId(layer: number, index: number): string {
  return `packages/l${layer}p${index}`;
}

function importerName(layer: number, index: number): string {
  return `@w/l${layer}p${index}`;
}

export function buildSyntheticWorkspace(
  options: SyntheticWorkspaceOptions,
): SyntheticWorkspace {
  const { layers, width, chainLength, linkKind = "dev" } = options;

  const importers: PnpmLockfile["importers"] = {};
  const packages: PnpmLockfile["packages"] = {};
  const snapshots: PnpmLockfile["snapshots"] = {};

  // Shared npm dependency chain: lib0 -> lib1 -> ... -> lib{chainLength-1}
  for (let i = 0; i < chainLength; i++) {
    const id = `lib${i}@1.0.0`;
    packages[id] = { resolution: { integrity: `sha512-lib${i}` } };
    snapshots[id] =
      i + 1 < chainLength ? { dependencies: { [`lib${i + 1}`]: "1.0.0" } } : {};
  }

  const rootLinks: Record<string, { specifier: string; version: string }> = {};
  for (let j = 0; j < width; j++) {
    rootLinks[importerName(0, j)] = {
      specifier: "workspace:*",
      version: `link:${importerId(0, j)}`,
    };
  }
  importers["."] = { dependencies: rootLinks };

  for (let layer = 0; layer < layers; layer++) {
    for (let index = 0; index < width; index++) {
      const links: Record<string, { specifier: string; version: string }> = {};
      if (layer + 1 < layers) {
        for (let next = 0; next < width; next++) {
          links[importerName(layer + 1, next)] = {
            specifier: "workspace:*",
            version: `link:../l${layer + 1}p${next}`,
          };
        }
      }

      const npmDeps = { lib0: { specifier: "1.0.0", version: "1.0.0" } };

      importers[importerId(layer, index)] =
        linkKind === "dev"
          ? { dependencies: npmDeps, devDependencies: links }
          : { dependencies: { ...npmDeps, ...links } };
    }
  }

  return {
    lockfile: { lockfileVersion: "9.0", importers, packages, snapshots },
    importerCount: layers * width + 1,
    packageCount: chainLength,
    linkPathCount: Math.pow(width, layers),
  };
}

/**
 * Write a lockfile to a bare temp directory (no node_modules), which forces
 * DependencyTracker down the lockfile-only fallback path.
 */
export function writeSyntheticLockfile(
  lockfile: PnpmLockfile,
  label: string,
): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `pnpm-lock-bench-${label}-`),
  );
  const lockfilePath = path.join(dir, "pnpm-lock.yaml");
  fs.writeFileSync(lockfilePath, yaml.dump(lockfile), "utf-8");
  return lockfilePath;
}

export interface TreeMetrics {
  /**
   * Number of distinct PackageNode objects retained by the trees.
   * This is the memory proxy: shared subtrees are counted once, rebuilt
   * subtrees are counted once per rebuild.
   */
  distinctNodes: number;
  /** Number of parent->child edges in the retained graph (roots included). */
  edges: number;
}

/**
 * Count nodes by object identity so the walk terminates on a DAG and the
 * result reflects allocation, not path count.
 */
export function measureTrees(
  trees: Record<string, PackageNode[]>,
): TreeMetrics {
  const seen = new Set<PackageNode>();
  let edges = 0;

  const stack: PackageNode[] = [];
  for (const roots of Object.values(trees)) {
    stack.push(...roots);
  }

  while (stack.length > 0) {
    const node = stack.pop()!;
    edges++;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const child of node.dependencies ?? []) {
      stack.push(child);
    }
  }

  return { distinctNodes: seen.size, edges };
}
