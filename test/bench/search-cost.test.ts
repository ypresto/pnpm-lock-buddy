import { describe, it, expect } from "vitest";
import { DependencyTracker } from "../../src/core/dependency-tracker";
import {
  buildSyntheticWorkspace,
  writeSyntheticLockfile,
  measureTrees,
  libName,
} from "./synthetic-lockfile";

/**
 * Per-call cost of the tree searches, measured with distinct targets so
 * allPathsCache never hits, on a fresh tracker per repetition.
 *
 * The npm dependency graph here has 2^npmLayers distinct root-to-leaf paths
 * but only 2*npmLayers packages, so a search that walks paths and one that
 * walks nodes diverge by orders of magnitude as npmLayers grows.
 *
 * Measured with subtrees shared but the identity check and the reachability
 * pruning removed (npmLayers 14, 3 samples): allPaths 28.6ms, absent target
 * 169ms, dependency map 1.5s per call.
 */
const WARMUP = 5;
const REPS = 20;

async function measure(npmLayers: number) {
  const workspace = buildSyntheticWorkspace({
    layers: 2,
    width: 2,
    npmLayers,
    npmWidth: 2,
  });
  const lockfilePath = writeSyntheticLockfile(workspace.lockfile, "search");

  const targets: string[] = [];
  for (let depth = 0; depth < npmLayers; depth++) {
    for (let index = 0; index < 2; index++) {
      targets.push(`${libName(depth, index)}@1.0.0`);
    }
  }

  let nodes = 0;
  const totals = { allPaths: 0, absent: 0, single: 0, map: 0 };
  const counts = { allPaths: 0, absent: 0, single: 0, map: 0 };

  for (let rep = 0; rep < WARMUP + REPS; rep++) {
    const timed = rep >= WARMUP;
    const tracker = new DependencyTracker(lockfilePath);
    nodes = measureTrees(await tracker.getDependencyTrees()).distinctNodes;

    const record = async (
      key: keyof typeof totals,
      call: () => Promise<unknown>,
    ) => {
      const start = process.hrtime.bigint();
      await call();
      if (timed) {
        totals[key] += Number(process.hrtime.bigint() - start);
        counts[key]++;
      }
    };

    await record("map", () =>
      tracker.getImportersForPackage(`${libName(npmLayers - 1, 0)}@1.0.0`),
    );
    for (const target of targets) {
      await record("allPaths", () =>
        tracker.getAllDependencyPaths(".", target),
      );
      await record("single", () => tracker.getDependencyPath(".", target));
    }
    for (let i = 0; i < 10; i++) {
      await record("absent", () =>
        tracker.getAllDependencyPaths(".", `absent${rep}x${i}@1.0.0`),
      );
    }
  }

  const us = (key: keyof typeof totals) => totals[key] / counts[key] / 1000;
  return {
    npmLayers,
    npmPaths: workspace.npmPathCount,
    nodes,
    allPathsUs: us("allPaths"),
    absentUs: us("absent"),
    singleUs: us("single"),
    mapUs: us("map"),
  };
}

describe("search cost per call", () => {
  it("tracks node count, not path count", async () => {
    const small = await measure(10);
    const large = await measure(30);

    console.table(
      [small, large].map((r) => ({
        ...r,
        npmPaths: r.npmPaths.toExponential(1),
        allPathsUs: r.allPathsUs.toFixed(1),
        absentUs: r.absentUs.toFixed(1),
        singleUs: r.singleUs.toFixed(1),
        mapUs: r.mapUs.toFixed(1),
      })),
    );

    // 2^29 more paths, 2.1x the nodes.
    expect(large.npmPaths / small.npmPaths).toBeGreaterThan(1e6);
    expect(large.nodes / small.nodes).toBeLessThan(3);

    // Every search must stay in the same order of magnitude as the small case.
    // Without pruning the 30 layer case would take minutes per call.
    expect(large.allPathsUs).toBeLessThan(small.allPathsUs * 20 + 5000);
    expect(large.absentUs).toBeLessThan(small.absentUs * 20 + 5000);
    expect(large.singleUs).toBeLessThan(small.singleUs * 20 + 5000);
    expect(large.mapUs).toBeLessThan(small.mapUs * 20 + 5000);
  }, 600_000);
});
