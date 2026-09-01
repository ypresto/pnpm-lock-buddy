import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { buildDependenciesTree } from "@pnpm/deps.inspection.tree-builder";
import type { DependencyNode } from "@pnpm/deps.inspection.tree-builder";
import {
  materializeDedupedNodes,
  canonicalizeLinkVersions,
} from "../../../src/core/tree-dedup";
import { DependencyTracker } from "../../../src/core/dependency-tracker";

/**
 * Drives the REAL @pnpm/deps.inspection.tree-builder (not a mock — see
 * CLAUDE.md's "NEVER use mocking" rule) with a hand-written lockfile, no
 * `pnpm install` required: the library falls back to the wanted lockfile
 * when there's no current lockfile / modules manifest to read
 * (buildDependenciesTree.js's `currentLockfile ?? wantedLockfile`), and
 * resolves packages straight from the lockfile graph.
 *
 * Fixture shape (why): two importers (apps/a, apps/b) both depend on the
 * same npm package (common-lib@1.0.0) and both link to the same workspace
 * project (packages/shared), which itself links to a second workspace
 * project (packages/deep) — modeling the real shape that caused a
 * cross-project contamination regression (one project's dependencies
 * attributed to a different, unrelated project) when this tool called
 * buildDependenciesTree with a finite depth across multiple projects at
 * once. This shared, multi-level structure is exactly what makes the
 * library return `deduped: true` stubs, and having a link node
 * (packages/deep) *inside* the shared subtree is what exercises
 * canonicalizeLinkVersions (the library rebases a link node's `version` to
 * whichever project's traversal first materialized it — wrong for every
 * other project that reuses that subtree from the cache).
 */

let workspaceDir: string;

beforeAll(() => {
  workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pnpm-lock-buddy-batch-integration-"),
  );

  const lockfileYaml = `
lockfileVersion: '9.0'

importers:
  apps/a:
    dependencies:
      '@ws/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      common-lib:
        specifier: 1.0.0
        version: 1.0.0
      a-only-lib:
        specifier: 1.0.0
        version: 1.0.0
      '@ws/injected':
        specifier: workspace:*
        version: file:packages/injected(peer-lib@1.0.0)
      peer-lib:
        specifier: 1.0.0
        version: 1.0.0

  apps/b:
    dependencies:
      '@ws/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      common-lib:
        specifier: 1.0.0
        version: 1.0.0
      '@ws/injected':
        specifier: workspace:*
        version: file:packages/injected(peer-lib@2.0.0)
      peer-lib:
        specifier: 2.0.0
        version: 2.0.0

  packages/shared:
    dependencies:
      '@ws/deep':
        specifier: workspace:*
        version: link:../deep
      '@ws/injected':
        specifier: workspace:*
        version: file:packages/injected(peer-lib@2.0.0)
      peer-lib:
        specifier: 2.0.0
        version: 2.0.0

  packages/deep:
    dependencies:
      leaf-lib:
        specifier: 1.0.0
        version: 1.0.0
      '@ws/injected':
        specifier: workspace:*
        version: file:packages/injected(peer-lib@1.0.0)
      peer-lib:
        specifier: 1.0.0
        version: 1.0.0

packages:
  common-lib@1.0.0:
    resolution: {integrity: sha512-common}
    dependencies:
      common-lib-dep: 1.0.0

  common-lib-dep@1.0.0:
    resolution: {integrity: sha512-commondep}

  leaf-lib@1.0.0:
    resolution: {integrity: sha512-leaf}

  a-only-lib@1.0.0:
    resolution: {integrity: sha512-aonly}

  '@ws/injected@file:packages/injected':
    resolution: {directory: packages/injected, type: directory}
    name: '@ws/injected'
    version: 0.0.0
    peerDependencies:
      peer-lib: '*'

  peer-lib@1.0.0:
    resolution: {integrity: sha512-peerlib1}

  peer-lib@2.0.0:
    resolution: {integrity: sha512-peerlib2}

snapshots:
  common-lib@1.0.0:
    dependencies:
      common-lib-dep: 1.0.0

  common-lib-dep@1.0.0: {}

  leaf-lib@1.0.0: {}

  a-only-lib@1.0.0: {}

  '@ws/injected@file:packages/injected(peer-lib@1.0.0)':
    dependencies:
      peer-lib: 1.0.0

  '@ws/injected@file:packages/injected(peer-lib@2.0.0)':
    dependencies:
      peer-lib: 2.0.0

  peer-lib@1.0.0: {}

  peer-lib@2.0.0: {}
`;

  fs.writeFileSync(
    path.join(workspaceDir, "pnpm-lock.yaml"),
    lockfileYaml,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(workspaceDir, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n  - packages/*\n",
    "utf-8",
  );
  for (const importer of [
    "apps/a",
    "apps/b",
    "packages/shared",
    "packages/deep",
    "packages/injected", // file:-resolved, not a workspace importer, but still a real directory
  ]) {
    fs.mkdirSync(path.join(workspaceDir, importer), { recursive: true });
  }
});

afterAll(() => {
  if (workspaceDir && fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true });
  }
});

function findNode(
  nodes: DependencyNode[] | undefined,
  name: string,
): DependencyNode | undefined {
  if (!nodes) return undefined;
  for (const node of nodes) {
    if (node.name === name) return node;
    const found = findNode(node.dependencies, name);
    if (found) return found;
  }
  return undefined;
}

describe("batch depth:Infinity buildDependenciesTree call (real library, no install)", () => {
  it("returns at least one deduped stub across the shared projects (canary: fails loudly if the library stops sharing content this way)", async () => {
    const projectPaths = [
      "apps/a",
      "apps/b",
      "packages/deep",
      "packages/shared",
    ]
      .sort()
      .map((id) => path.join(workspaceDir, id));

    const result = await buildDependenciesTree(projectPaths, {
      depth: Infinity,
      lockfileDir: workspaceDir,
      virtualStoreDirMaxLength: 120,
    });

    const hasDedupedAnywhere = (
      nodes: DependencyNode[] | undefined,
    ): boolean => {
      if (!nodes) return false;
      return nodes.some(
        (n) => n.deduped === true || hasDedupedAnywhere(n.dependencies),
      );
    };

    const allNodes = Object.values(result).flatMap((tree) => [
      ...(tree.dependencies ?? []),
      ...(tree.devDependencies ?? []),
      ...(tree.optionalDependencies ?? []),
    ]);
    expect(allNodes.length).toBeGreaterThan(0);
    expect(hasDedupedAnywhere(allNodes)).toBe(true);
  });

  it("restores every project's tree to its real, complete content — no project missing dependencies it actually has", async () => {
    const importerIds = [
      "apps/a",
      "apps/b",
      "packages/deep",
      "packages/shared",
    ].sort();
    const projectPaths = importerIds.map((id) => path.join(workspaceDir, id));

    const result = await buildDependenciesTree(projectPaths, {
      depth: Infinity,
      lockfileDir: workspaceDir,
      virtualStoreDirMaxLength: 120,
    });

    materializeDedupedNodes(result);
    canonicalizeLinkVersions(result, workspaceDir);

    for (const id of ["apps/a", "apps/b"]) {
      const projectDir = path.join(workspaceDir, id);
      const tree = result[projectDir]!;
      const allNodes = [
        ...(tree.dependencies ?? []),
        ...(tree.devDependencies ?? []),
        ...(tree.optionalDependencies ?? []),
      ];

      // Both apps depend on common-lib -> common-lib-dep and
      // @ws/shared -> @ws/deep -> leaf-lib. Every one of these must be
      // present and non-empty, in EVERY project's own tree, regardless of
      // which project happened to be the "donor" that first materialized
      // the shared subtree in this batch call.
      const commonLib = findNode(allNodes, "common-lib");
      expect(
        commonLib?.dependencies?.some((d) => d.name === "common-lib-dep"),
      ).toBe(true);

      const sharedLink = findNode(allNodes, "@ws/shared");
      const deepLink = findNode(sharedLink?.dependencies, "@ws/deep");
      expect(deepLink).toBeDefined();
      expect(deepLink?.dependencies?.some((d) => d.name === "leaf-lib")).toBe(
        true,
      );
    }
  });

  it("canonicalizes every link node's version to be workspace-root-relative, even under the project that borrowed the shared subtree from cache", async () => {
    const importerIds = [
      "apps/a",
      "apps/b",
      "packages/deep",
      "packages/shared",
    ].sort();
    const projectPaths = importerIds.map((id) => path.join(workspaceDir, id));

    const result = await buildDependenciesTree(projectPaths, {
      depth: Infinity,
      lockfileDir: workspaceDir,
      virtualStoreDirMaxLength: 120,
    });

    materializeDedupedNodes(result);
    canonicalizeLinkVersions(result, workspaceDir);

    for (const id of ["apps/a", "apps/b", "packages/shared"]) {
      const projectDir = path.join(workspaceDir, id);
      const tree = result[projectDir]!;
      const allNodes = [
        ...(tree.dependencies ?? []),
        ...(tree.devDependencies ?? []),
        ...(tree.optionalDependencies ?? []),
      ];

      const deepLink =
        id === "packages/shared"
          ? findNode(allNodes, "@ws/deep")
          : (() => {
              const sharedLink = findNode(allNodes, "@ws/shared");
              expect(sharedLink).toBeDefined();
              return findNode(sharedLink?.dependencies, "@ws/deep");
            })();

      expect(deepLink?.version).toBe("link:packages/deep");
    }
  });

  it("does not conflate two peer-dependency variants of the same file-resolved package sharing one physical path", async () => {
    // @ws/injected is `file:`-resolved: both peer variants below live at the
    // exact same physical directory (packages/injected), unlike a normal
    // npm package where a different peer resolution gets a different store
    // path. path alone can't tell these apart — only peersSuffixHash can
    // (see nodeIdentityKey's doc comment). Each variant has two consumers
    // (so each gets its own genuine deduped stub to restore, not just an
    // original occurrence that never needed lookup): apps/a and
    // packages/deep both use peer-lib@1.0.0; apps/b and packages/shared
    // both use peer-lib@2.0.0. A path-only key would let one variant's
    // stub restore with the other variant's content.
    const importerIds = [
      "apps/a",
      "apps/b",
      "packages/deep",
      "packages/shared",
    ].sort();
    const projectPaths = importerIds.map((id) => path.join(workspaceDir, id));

    const result = await buildDependenciesTree(projectPaths, {
      depth: Infinity,
      lockfileDir: workspaceDir,
      virtualStoreDirMaxLength: 120,
    });

    materializeDedupedNodes(result);

    const expectedPeerVersion: Record<string, string> = {
      "apps/a": "1.0.0",
      "packages/deep": "1.0.0",
      "apps/b": "2.0.0",
      "packages/shared": "2.0.0",
    };

    for (const [id, expectedVersion] of Object.entries(expectedPeerVersion)) {
      const projectDir = path.join(workspaceDir, id);
      const tree = result[projectDir]!;
      const allNodes = [
        ...(tree.dependencies ?? []),
        ...(tree.devDependencies ?? []),
        ...(tree.optionalDependencies ?? []),
      ];

      // Direct (top-level) lookup only — NOT the recursive findNode helper:
      // packages/shared's tree also reaches packages/deep's own @ws/injected
      // transitively (through the @ws/deep link), so a recursive search for
      // the first node named "@ws/injected" can find that nested one instead
      // of packages/shared's own direct dependency of the same name.
      const injected = allNodes.find((n) => n.name === "@ws/injected");
      expect(injected).toBeDefined();
      const peerLib = injected?.dependencies?.find(
        (d) => d.name === "peer-lib",
      );
      expect(peerLib?.version).toBe(expectedVersion);
    }
  });
});

describe("DependencyTracker end-to-end with the real virtual-store gate satisfied", () => {
  beforeAll(() => {
    // hasRealVirtualStore() only requires a real *directory* under
    // node_modules/.pnpm — the library itself needs no actual installed
    // package contents (see the suite-level comment above).
    fs.mkdirSync(
      path.join(workspaceDir, "node_modules", ".pnpm", "dummy@1.0.0"),
      {
        recursive: true,
      },
    );
  });

  it("finds importers for a package reached only through a shared, nested link subtree", async () => {
    const tracker = new DependencyTracker(
      path.join(workspaceDir, "pnpm-lock.yaml"),
    );

    const importers = await tracker.getImportersForPackage("leaf-lib@1.0.0");

    // packages/deep declares leaf-lib directly; apps/a, apps/b, and
    // packages/shared all reach it transitively through the shared
    // @ws/shared -> @ws/deep link chain.
    expect(importers.sort()).toEqual(
      ["apps/a", "apps/b", "packages/deep", "packages/shared"].sort(),
    );
  });

  it("does not attribute a project-private dependency to every project (no cross-project contamination)", async () => {
    const tracker = new DependencyTracker(
      path.join(workspaceDir, "pnpm-lock.yaml"),
    );

    // apps/a is the alphabetically-first (and so first-materialized, hence
    // "donor") importer in this batch, and the only one that depends on
    // a-only-lib. If the batch's shared materialization cache leaked
    // content across projects the way the reverted heuristic fix did, this
    // is exactly the shape that would surface it: apps/b or packages/shared
    // wrongly "inheriting" apps/a's private dependency.
    const importers = await tracker.getImportersForPackage("a-only-lib@1.0.0");
    expect(importers).toEqual(["apps/a"]);
  });
});
