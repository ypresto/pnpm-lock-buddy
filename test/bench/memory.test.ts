import { describe, it, expect } from "vitest";
import { DependencyTracker } from "../../src/core/dependency-tracker";
import {
  buildSyntheticWorkspace,
  writeSyntheticLockfile,
  measureTrees,
  type SyntheticWorkspaceOptions,
} from "./synthetic-lockfile";

/**
 * Retained heap after building the dependency trees.
 *
 * Run via `pnpm bench`, which passes --expose-gc. Without it the numbers are
 * dominated by uncollected garbage, so the assertion is skipped and the run is
 * informational only.
 *
 * Baseline before the tree sharing work, for the same shapes:
 *   diamond-l5w3 npm30      8.4MB    27,885 nodes
 *   flat-w50 npm30          1.2MB     3,050 nodes
 *   monorepo-l4w4 npm40x2  50.0MB   245,052 nodes
 *   monorepo-l5w4 npm60x2 302.7MB 1,495,876 nodes
 */
const SHAPES: Array<[string, SyntheticWorkspaceOptions]> = [
  ["diamond-l5w3 npm30", { layers: 5, width: 3, npmLayers: 30 }],
  ["flat-w50 npm30", { layers: 1, width: 50, npmLayers: 30 }],
  [
    "monorepo-l4w4 npm40x2",
    { layers: 4, width: 4, npmLayers: 40, npmWidth: 2 },
  ],
  [
    "monorepo-l5w4 npm60x2",
    { layers: 5, width: 4, npmLayers: 60, npmWidth: 2 },
  ],
];

function collectGarbage(): boolean {
  const runtime = globalThis as unknown as { gc?: () => void };
  if (!runtime.gc) return false;
  for (let i = 0; i < 4; i++) runtime.gc();
  return true;
}

describe("retained heap", () => {
  it.each(SHAPES)(
    "stays flat for %s",
    async (label, options) => {
      const workspace = buildSyntheticWorkspace(options);
      const lockfilePath = writeSyntheticLockfile(workspace.lockfile, "mem");

      const canMeasure = collectGarbage();
      const before = process.memoryUsage().heapUsed;

      const tracker = new DependencyTracker(lockfilePath);
      const trees = await tracker.getDependencyTrees();

      collectGarbage();
      const heapMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
      const nodes = measureTrees(trees).distinctNodes;

      console.log(
        `${label}: ${heapMb.toFixed(1)}MB, ${nodes} nodes ` +
          `(${workspace.importerCount} importers, ${workspace.packageCount} packages)`,
      );

      expect(nodes).toBeLessThan(5000);
      if (canMeasure) {
        expect(heapMb).toBeLessThan(20);
      }
    },
    600_000,
  );
});
