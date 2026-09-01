import { describe, it, expect } from "vitest";
import type { DependencyNode } from "@pnpm/deps.inspection.tree-builder";
import { computeShallowestDepths } from "../../../src/core/tree-depth";

function node(
  overrides: Partial<DependencyNode> & { name: string },
): DependencyNode {
  return {
    alias: overrides.name,
    isPeer: false,
    isSkipped: false,
    isMissing: false,
    path: `/store/${overrides.name}`,
    version: "1.0.0",
    ...overrides,
  };
}

describe("computeShallowestDepths", () => {
  it("assigns depth 1 to root nodes", () => {
    const a = node({ name: "a" });
    const b = node({ name: "b" });

    const depths = computeShallowestDepths([a, b], 10);

    expect(depths.get(a)).toBe(1);
    expect(depths.get(b)).toBe(1);
  });

  it("assigns increasing depth down a chain", () => {
    const grandchild = node({ name: "grandchild" });
    const child = node({ name: "child", dependencies: [grandchild] });
    const root = node({ name: "root", dependencies: [child] });

    const depths = computeShallowestDepths([root], 10);

    expect(depths.get(root)).toBe(1);
    expect(depths.get(child)).toBe(2);
    expect(depths.get(grandchild)).toBe(3);
  });

  it("excludes nodes only reachable beyond maxDepth", () => {
    const tooDeep = node({ name: "too-deep" });
    const child = node({ name: "child", dependencies: [tooDeep] });
    const root = node({ name: "root", dependencies: [child] });

    const depths = computeShallowestDepths([root], 2);

    expect(depths.get(root)).toBe(1);
    expect(depths.get(child)).toBe(2);
    expect(depths.has(tooDeep)).toBe(false);
  });

  it("records a shared node at its shallowest depth, reached via either a shallow or a deep path", () => {
    const shared = node({ name: "shared" });
    // Shallow path: root -> shared (depth 2)
    // Deep path: root -> mid -> deepChild -> shared (depth 4)
    const deepChild = node({ name: "deep-child", dependencies: [shared] });
    const mid = node({ name: "mid", dependencies: [deepChild] });
    const root = node({
      name: "root",
      dependencies: [shared, mid],
    });

    const depths = computeShallowestDepths([root], 10);

    // shared is reachable at depth 2 (direct) and depth 4 (via mid); shallowest wins
    expect(depths.get(shared)).toBe(2);
  });

  it("includes a shared node when its shallowest occurrence is within maxDepth, even if a deeper occurrence would exceed it", () => {
    const shared = node({ name: "shared" });
    const deepChild = node({ name: "deep-child", dependencies: [shared] });
    const mid1 = node({ name: "mid1", dependencies: [deepChild] });
    const mid2 = node({ name: "mid2", dependencies: [deepChild] });
    const mid3 = node({ name: "mid3", dependencies: [mid2] });
    const root = node({
      name: "root",
      // shared directly at depth 2, and also nested past maxDepth via mid1/mid3 chains
      dependencies: [shared, mid1, mid3],
    });

    const depths = computeShallowestDepths([root], 2);

    expect(depths.get(shared)).toBe(2);
    expect(depths.has(deepChild)).toBe(false); // only reachable at depth 3 here
  });

  it("does not infinite-loop on a node whose dependencies array contains itself indirectly (already-visited guard)", () => {
    const nodeA: DependencyNode = node({ name: "a" });
    const nodeB: DependencyNode = node({ name: "b", dependencies: [nodeA] });
    nodeA.dependencies = [nodeB]; // artificial cycle (real data never has one: circular nodes have dependencies stripped)

    const depths = computeShallowestDepths([nodeA], 50);

    expect(depths.get(nodeA)).toBe(1);
    expect(depths.get(nodeB)).toBe(2);
  });

  it("returns an empty map for an empty roots array", () => {
    expect(computeShallowestDepths([], 10).size).toBe(0);
  });
});
