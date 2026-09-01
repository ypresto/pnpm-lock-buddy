import { describe, it, expect } from "vitest";
import type { DependencyNode } from "@pnpm/deps.inspection.tree-builder";
import {
  materializeDedupedNodes,
  canonicalizeLinkVersions,
} from "../../../src/core/tree-dedup";

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

describe("canonicalizeLinkVersions", () => {
  const lockfileDir = "/repo";

  it("rewrites a link node's version relative to lockfileDir, from its absolute path", () => {
    const linkNode = node({
      name: "shared-lib",
      path: "/repo/packages/shared-lib",
      version: "link:../../shared-lib", // wrong: relative to some other project
    });
    const trees = { "packages/app": { dependencies: [linkNode] } };

    canonicalizeLinkVersions(trees, lockfileDir);

    expect(linkNode.version).toBe("link:packages/shared-lib");
  });

  it("is idempotent — calling twice does not double-relativize", () => {
    const linkNode = node({
      name: "shared-lib",
      path: "/repo/packages/shared-lib",
      version: "link:../wrong",
    });
    const trees = { "packages/app": { dependencies: [linkNode] } };

    canonicalizeLinkVersions(trees, lockfileDir);
    const afterFirst = linkNode.version;
    canonicalizeLinkVersions(trees, lockfileDir);

    expect(linkNode.version).toBe(afterFirst);
    expect(linkNode.version).toBe("link:packages/shared-lib");
  });

  it("leaves non-link versions unchanged", () => {
    const npmNode = node({
      name: "react",
      path: "/repo/node_modules/.pnpm/react@18.2.0/node_modules/react",
      version: "18.2.0",
    });
    const trees = { "packages/app": { dependencies: [npmNode] } };

    canonicalizeLinkVersions(trees, lockfileDir);

    expect(npmNode.version).toBe("18.2.0");
  });

  it("leaves link nodes with a non-absolute (fallback-builder) path unchanged", () => {
    const fallbackLinkNode = node({
      name: "shared-lib",
      path: "node_modules/shared-lib", // relative placeholder, not absolute
      version: "link:../shared-lib",
    });
    const trees = { "packages/app": { dependencies: [fallbackLinkNode] } };

    canonicalizeLinkVersions(trees, lockfileDir);

    expect(fallbackLinkNode.version).toBe("link:../shared-lib");
  });

  it("canonicalizes link nodes nested several levels deep", () => {
    const deepLink = node({
      name: "deep-lib",
      path: "/repo/packages/deep-lib",
      version: "link:../../../wrong",
    });
    const middle = node({
      name: "middle",
      path: "/repo/node_modules/.pnpm/middle@1.0.0/node_modules/middle",
      version: "1.0.0",
      dependencies: [deepLink],
    });
    const trees = { "packages/app": { dependencies: [middle] } };

    canonicalizeLinkVersions(trees, lockfileDir);

    expect(deepLink.version).toBe("link:packages/deep-lib");
  });

  it("canonicalizes a link node's version exactly once when its dependencies array is shared across projects", () => {
    const shared = node({
      name: "shared-lib",
      path: "/repo/packages/shared-lib",
      version: "link:donor-relative-wrong",
    });
    const sharedDeps = [shared];
    const projectAEntry = node({
      name: "consumer",
      path: "/repo/node_modules/.pnpm/consumer@1.0.0/node_modules/consumer",
      version: "1.0.0",
      dependencies: sharedDeps,
    });
    const projectBEntry = node({
      name: "consumer",
      path: "/repo/node_modules/.pnpm/consumer@1.0.0/node_modules/consumer",
      version: "1.0.0",
      dependencies: sharedDeps, // same array reference, as materializeDedupedNodes would leave it
    });

    const trees = {
      "packages/a": { dependencies: [projectAEntry] },
      "packages/b": { dependencies: [projectBEntry] },
    };

    canonicalizeLinkVersions(trees, lockfileDir);

    expect(shared.version).toBe("link:packages/shared-lib");
  });
});
