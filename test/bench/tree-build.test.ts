import { describe, it, expect } from "vitest";
import { DependencyTracker } from "../../src/core/dependency-tracker";
import {
  buildSyntheticWorkspace,
  writeSyntheticLockfile,
  measureTrees,
  libName,
  type SyntheticWorkspaceOptions,
} from "./synthetic-lockfile";

interface BenchResult {
  label: string;
  importers: number;
  /** Root-to-leaf paths through the workspace link graph. */
  linkPaths: number;
  /** Distinct DependencyNode objects retained (memory proxy). */
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

const NPM_LAYERS = 20;

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
      npmLayers: NPM_LAYERS,
    });
    const deep = await buildTrees("diamond-l6", {
      layers: 6,
      width: 3,
      npmLayers: NPM_LAYERS,
    });

    const nodeGrowth = deep.distinctNodes / shallow.distinctNodes;
    const pathGrowth = deep.linkPaths / shallow.linkPaths;
    const importerGrowth = deep.importers / shallow.importers;

    console.table([shallow, deep]);
    console.log(
      `node growth ${nodeGrowth.toFixed(1)}x ` +
        `(importers ${importerGrowth.toFixed(1)}x, paths ${pathGrowth.toFixed(1)}x)`,
    );

    // What remains is one link node per link edge per tree, i.e. roughly
    // importers^2 * width - polynomial, not exponential. Measured 6.5x against
    // the 27x path growth; 29.4x before the fix.
    expect(nodeGrowth).toBeLessThan(10);
  }, 120_000);

  /**
   * Every workspace package pulls in the same npm chain. Rebuilding that chain
   * per importer is the O(importers x deps x closure) factor; sharing it makes
   * the retained node count independent of the importer count.
   *
   * Measured before the fix: 1230 nodes for 31 importers x a 20 package chain.
   */
  it("shares an npm subtree across importers instead of rebuilding it", async () => {
    const flat = await buildTrees("flat-w30", {
      layers: 1,
      width: 30,
      npmLayers: NPM_LAYERS,
    });

    console.table([flat]);

    // One node per link plus one per importer-local head of the chain, and the
    // chain itself shared once: far below importers * npmLayers.
    expect(flat.distinctNodes).toBeLessThan(200);
  }, 120_000);

  /**
   * Building the dependency map walks the trees. Once subtrees are shared the
   * trees are DAGs, so a walk without an identity-visited set follows every
   * distinct path and goes exponential.
   */
  it("builds the dependency map without walking every path", async () => {
    const workspace = buildSyntheticWorkspace({
      layers: 10,
      width: 3,
      npmLayers: NPM_LAYERS,
    });
    const lockfilePath = writeSyntheticLockfile(workspace.lockfile, "map-l10");
    // This bench is about path-explosion avoidance in the dependency map,
    // not --depth truncation: the target sits at npm layer NPM_LAYERS - 1,
    // so depth must comfortably exceed that for it to be reachable at all.
    const tracker = new DependencyTracker(lockfilePath, NPM_LAYERS + 5);

    const start = performance.now();
    const importers = await tracker.getImportersForPackage(
      `${libName(NPM_LAYERS - 1, 0)}@1.0.0`,
    );
    const ms = performance.now() - start;

    console.log(
      `map build over ${workspace.importerCount} importers ` +
        `(${workspace.linkPathCount} link paths): ${Math.round(ms)}ms`,
    );

    expect(importers).toContain(".");
    expect(importers).toHaveLength(workspace.importerCount);
    // Generous: a path-count walk over 3^10 paths takes tens of seconds.
    expect(ms).toBeLessThan(2000);
  }, 120_000);

  /**
   * With subtrees shared, the trees are DAGs: an npm graph where every package
   * on a layer depends on every package on the next has 2^layers distinct
   * paths but only 2*layers nodes. Anything that walks paths instead of nodes
   * goes exponential here.
   *
   * Measured with shared subtrees but no pruning (131072 paths):
   * map build 3679ms, search for an absent package 2075ms.
   */
  it("walks nodes rather than paths on a diamond-shaped npm graph", async () => {
    const workspace = buildSyntheticWorkspace({
      layers: 1,
      width: 2,
      npmLayers: 18,
      npmWidth: 2,
    });
    const lockfilePath = writeSyntheticLockfile(workspace.lockfile, "npm-dia");
    // Same reasoning as above: target is at npm layer 17, so depth must
    // exceed that for this path-explosion bench to be meaningful.
    const tracker = new DependencyTracker(lockfilePath, 20);

    const trees = await tracker.getDependencyTrees();
    const nodes = measureTrees(trees).distinctNodes;

    let start = performance.now();
    const importers = await tracker.getImportersForPackage(
      `${libName(17, 0)}@1.0.0`,
    );
    const mapMs = performance.now() - start;

    start = performance.now();
    const absent = await tracker.getAllDependencyPaths(".", "absent@1.0.0");
    const searchMs = performance.now() - start;

    console.log(
      `npm paths ${workspace.npmPathCount}, nodes ${nodes}, ` +
        `map ${Math.round(mapMs)}ms, absent-target search ${Math.round(searchMs)}ms`,
    );

    expect(importers).toContain(".");
    expect(absent).toEqual([]);
    expect(nodes).toBeLessThan(200);
    expect(mapMs).toBeLessThan(500);
    expect(searchMs).toBeLessThan(500);
  }, 120_000);

  it("reports the cost profile across shapes", async () => {
    const rows: BenchResult[] = [];
    for (const layers of [2, 3, 4, 5, 6]) {
      rows.push(
        await buildTrees(`diamond-l${layers}`, {
          layers,
          width: 3,
          npmLayers: NPM_LAYERS,
        }),
      );
    }
    // Same importer count, 16x the paths.
    rows.push(
      await buildTrees("chain-l8w1", {
        layers: 8,
        width: 1,
        npmLayers: NPM_LAYERS,
      }),
    );
    rows.push(
      await buildTrees("diamond-l4w2", {
        layers: 4,
        width: 2,
        npmLayers: NPM_LAYERS,
      }),
    );
    // Flat workspace: every importer pulls the same npm closure.
    rows.push(
      await buildTrees("flat-w30", {
        layers: 1,
        width: 30,
        npmLayers: NPM_LAYERS,
      }),
    );

    console.table(rows);
    expect(rows).toHaveLength(8);
  }, 120_000);
});
