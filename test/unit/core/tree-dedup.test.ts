import { describe, it, expect } from "vitest";
import type { DependencyNode } from "@pnpm/deps.inspection.tree-builder";
import { materializeDedupedNodes } from "../../../src/core/tree-dedup";

// Minimal fields required by DependencyNode beyond what each test cares about.
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

describe("materializeDedupedNodes", () => {
  it("resolves a deduped node's dependencies from the fully-expanded occurrence sharing its path", () => {
    // shared-lib is expanded once (under project-a) and appears deduped
    // (empty dependencies) under project-b, per
    // @pnpm/deps.inspection.tree-builder's whole-workspace MaterializationCache.
    const leaf = node({ name: "leaf", path: "/store/leaf" });
    const sharedLibExpanded = node({
      name: "shared-lib",
      path: "/store/shared-lib",
      dependencies: [leaf],
    });
    const sharedLibDeduped = node({
      name: "shared-lib",
      path: "/store/shared-lib",
      deduped: true,
      dedupedDependenciesCount: 1,
    });

    const trees = {
      "project-a": { dependencies: [sharedLibExpanded] },
      "project-b": { dependencies: [sharedLibDeduped] },
    };

    materializeDedupedNodes(trees);

    expect(trees["project-b"].dependencies![0]!.dependencies).toEqual([leaf]);
  });

  it("leaves nodes without a matching expanded occurrence untouched (no crash, no dependencies fabricated)", () => {
    const orphanDeduped = node({
      name: "orphan",
      path: "/store/orphan",
      deduped: true,
    });
    const trees = { "project-a": { dependencies: [orphanDeduped] } };

    materializeDedupedNodes(trees);

    expect(trees["project-a"].dependencies![0]!.dependencies).toBeUndefined();
  });

  it("distinguishes two deduped nodes at the same path but different peer contexts via peersSuffixHash", () => {
    const leafA = node({ name: "leaf-a", path: "/store/leaf-a" });
    const leafB = node({ name: "leaf-b", path: "/store/leaf-b" });
    const expandedVariantA = node({
      name: "workspace-link",
      path: "/workspace/pkg",
      peersSuffixHash: "hashA",
      dependencies: [leafA],
    });
    const expandedVariantB = node({
      name: "workspace-link",
      path: "/workspace/pkg",
      peersSuffixHash: "hashB",
      dependencies: [leafB],
    });
    const dedupedVariantA = node({
      name: "workspace-link",
      path: "/workspace/pkg",
      peersSuffixHash: "hashA",
      deduped: true,
    });

    const trees = {
      "project-a": { dependencies: [expandedVariantA] },
      "project-b": { dependencies: [expandedVariantB] },
      "project-c": { dependencies: [dedupedVariantA] },
    };

    materializeDedupedNodes(trees);

    expect(trees["project-c"].dependencies![0]!.dependencies).toEqual([leafA]);
  });

  it("resolves deduped nodes nested several levels deep, not just at the tree root", () => {
    const grandchildLeaf = node({ name: "grandchild", path: "/store/gc" });
    const childExpanded = node({
      name: "child",
      path: "/store/child",
      dependencies: [grandchildLeaf],
    });
    const parentA = node({
      name: "parent",
      path: "/store/parent-a",
      dependencies: [childExpanded],
    });
    const childDeduped = node({
      name: "child",
      path: "/store/child",
      deduped: true,
    });
    const parentB = node({
      name: "parent",
      path: "/store/parent-b",
      dependencies: [childDeduped],
    });

    const trees = {
      "project-a": { dependencies: [parentA] },
      "project-b": { dependencies: [parentB] },
    };

    materializeDedupedNodes(trees);

    expect(
      trees["project-b"].dependencies![0]!.dependencies![0]!.dependencies,
    ).toEqual([grandchildLeaf]);
  });
});
