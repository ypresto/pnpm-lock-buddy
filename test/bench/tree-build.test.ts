import { describe, it, expect } from "vitest";
import { DependencyTracker } from "../../src/core/dependency-tracker";
import {
  buildSyntheticWorkspace,
  writeSyntheticLockfile,
  measureTrees,
  type SyntheticWorkspaceOptions,
} from "./synthetic-lockfile";

interface BenchResult {
  label: string;
  importers: number;
  /** Root-to-leaf paths through the workspace link graph. */
  linkPaths: number;
  /** Distinct PackageNode objects retained (memory proxy). */
  distinctNodes: number;
  ms: number;
}

async function buildTrees(
  label: string,
  options: SyntheticWorkspaceOptions,
): Promise<BenchResult> {
  const workspace = buildSyntheticWorkspace(options);
  const lockfilePath = writeSyntheticLockfile(workspace.lockfile, label);
  const tracker = new DependencyTracker(lockfilePath);

  const start = performance.now();
  const trees = await tracker.getDependencyTrees();
  const ms = performance.now() - start;

  return {
    label,
    importers: workspace.importerCount,
    linkPaths: workspace.linkPathCount,
    distinctNodes: measureTrees(trees).distinctNodes,
    ms: Math.round(ms),
  };
}

const CHAIN_LENGTH = 20;

describe("dependency tree build cost", () => {
  /**
   * The workspace link graph is a layered diamond: adding one layer multiplies
   * the number of root-to-leaf paths by `width` while adding only `width` more
   * importers.
   *
   * A build that shares (or at least does not re-expand) subtrees grows with
   * the importer count. A build that carries a per-path `visited` set rebuilds
   * every reachable subtree once per path, so it grows with the path count.
   *
   * Measured before the fix: 1944 -> 57123 nodes (29.4x), tracking the 27x
   * growth in path count almost exactly.
   */
  it("does not rebuild linked subtrees once per path", async () => {
    const shallow = await buildTrees("diamond-l3", {
      layers: 3,
      width: 3,
      chainLength: CHAIN_LENGTH,
    });
    const deep = await buildTrees("diamond-l6", {
      layers: 6,
      width: 3,
      chainLength: CHAIN_LENGTH,
    });

    const nodeGrowth = deep.distinctNodes / shallow.distinctNodes;
    const pathGrowth = deep.linkPaths / shallow.linkPaths;
    const importerGrowth = deep.importers / shallow.importers;

    console.table([shallow, deep]);
    console.log(
      `node growth ${nodeGrowth.toFixed(1)}x ` +
        `(importers ${importerGrowth.toFixed(1)}x, paths ${pathGrowth.toFixed(1)}x)`,
    );

    // Must stay far below the path growth (27x) even with slack for the
    // per-tree fan-out that improvement B has yet to remove.
    expect(nodeGrowth).toBeLessThan(6);
  }, 120_000);

  it("reports the cost profile across shapes", async () => {
    const rows: BenchResult[] = [];
    for (const layers of [2, 3, 4, 5, 6]) {
      rows.push(
        await buildTrees(`diamond-l${layers}`, {
          layers,
          width: 3,
          chainLength: CHAIN_LENGTH,
        }),
      );
    }
    // Same importer count, 16x the paths.
    rows.push(
      await buildTrees("chain-l8w1", {
        layers: 8,
        width: 1,
        chainLength: CHAIN_LENGTH,
      }),
    );
    rows.push(
      await buildTrees("diamond-l4w2", {
        layers: 4,
        width: 2,
        chainLength: CHAIN_LENGTH,
      }),
    );
    // Flat workspace: every importer pulls the same npm closure.
    rows.push(
      await buildTrees("flat-w30", {
        layers: 1,
        width: 30,
        chainLength: CHAIN_LENGTH,
      }),
    );

    console.table(rows);
    expect(rows).toHaveLength(8);
  }, 120_000);
});
