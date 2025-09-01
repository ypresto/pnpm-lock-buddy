import { describe, it, expect, vi } from "vitest";
import {
  traverseLockfile,
  traversePackages,
  traverseImporters,
  traverseSnapshots,
  type TraversalCallback,
  type TraversalContext,
} from "../../../src/core/traverser";
import type { PnpmLockfile } from "../../../src/core/lockfile";

describe("traverseLockfile", () => {
  const mockLockfile: PnpmLockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: {
          express: { specifier: "4.18.2", version: "4.18.2" },
        },
      },
      "packages/app": {
        dependencies: {
          lodash: { specifier: "4.17.21", version: "4.17.21" },
        },
      },
    },
    packages: {
      "express@4.18.2": {
        resolution: { integrity: "sha512-test1" },
        dependencies: { "body-parser": "1.20.0" },
      },
      "lodash@4.17.21": {
        resolution: { integrity: "sha512-test2" },
      },
    },
    snapshots: {
      "express@4.18.2": {
        dependencies: { "body-parser": "1.20.0" },
      },
    },
  };

  it("should traverse all sections by default", () => {
    const sections = new Set<string>();
    const callback: TraversalCallback = (context) => {
      if (context.path.length > 0) {
        sections.add(context.path[0]);
      }
    };

    traverseLockfile(mockLockfile, callback);

    expect(sections.has("importers")).toBe(true);
    expect(sections.has("packages")).toBe(true);
    expect(sections.has("snapshots")).toBe(true);
  });

  it("should respect section options", () => {
    const sections = new Set<string>();
    const callback: TraversalCallback = (context) => {
      if (context.path.length > 0) {
        sections.add(context.path[0]);
      }
    };

    traverseLockfile(mockLockfile, callback, {
      includeImporters: true,
      includePackages: false,
      includeSnapshots: false,
    });

    expect(sections.has("importers")).toBe(true);
    expect(sections.has("packages")).toBe(false);
    expect(sections.has("snapshots")).toBe(false);
  });

  it("should pass correct context to callback", () => {
    const contexts: TraversalContext[] = [];
    const callback: TraversalCallback = (context) => {
      if (context.key === "express") {
        contexts.push(context);
      }
    };

    traverseLockfile(mockLockfile, callback);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      key: "express",
      value: { specifier: "4.18.2", version: "4.18.2" },
      path: expect.arrayContaining([
        "importers",
        ".",
        "dependencies",
        "express",
      ]),
    });
  });
});

describe("traversePackages", () => {
  const mockPackages = {
    "express@4.18.2": {
      resolution: { integrity: "sha512-test1" },
      dependencies: { "body-parser": "1.20.0" },
    },
    "@types/node@20.10.0": {
      resolution: { integrity: "sha512-test2" },
    },
  };

  it("should traverse all packages", () => {
    const packages: string[] = [];
    const callback: TraversalCallback = (context) => {
      if (context.path.length === 2) {
        packages.push(context.key);
      }
    };

    traversePackages(mockPackages, callback);

    expect(packages).toEqual(["express@4.18.2", "@types/node@20.10.0"]);
  });

  it("should traverse package properties", () => {
    const dependencies: Array<{ package: string; dep: string }> = [];
    const callback: TraversalCallback = (context) => {
      if (context.path[2] === "dependencies" && context.path.length === 4) {
        dependencies.push({
          package: context.path[1],
          dep: context.key,
        });
      }
    };

    traversePackages(mockPackages, callback);

    expect(dependencies).toEqual([
      { package: "express@4.18.2", dep: "body-parser" },
    ]);
  });
});

describe("traverseImporters", () => {
  const mockImporters = {
    ".": {
      dependencies: {
        express: { specifier: "4.18.2", version: "4.18.2" },
      },
      devDependencies: {
        vitest: { specifier: "1.0.0", version: "1.0.0" },
      },
    },
    "packages/app": {
      dependencies: {
        lodash: { specifier: "4.17.21", version: "4.17.21" },
      },
    },
  };

  it("should traverse all importers", () => {
    const importers: string[] = [];
    const callback: TraversalCallback = (context) => {
      if (context.path.length === 2) {
        importers.push(context.key);
      }
    };

    traverseImporters(mockImporters, callback);

    expect(importers).toEqual([".", "packages/app"]);
  });

  it("should traverse different dependency types", () => {
    const deps: Array<{ type: string; name: string }> = [];
    const callback: TraversalCallback = (context) => {
      if (
        context.path.length === 4 &&
        ["dependencies", "devDependencies"].includes(context.path[2])
      ) {
        deps.push({
          type: context.path[2],
          name: context.key,
        });
      }
    };

    traverseImporters(mockImporters, callback);

    expect(deps).toContainEqual({ type: "dependencies", name: "express" });
    expect(deps).toContainEqual({ type: "devDependencies", name: "vitest" });
    expect(deps).toContainEqual({ type: "dependencies", name: "lodash" });
  });
});

describe("traverseSnapshots", () => {
  const mockSnapshots = {
    "express@4.18.2": {
      dependencies: { "body-parser": "1.20.0" },
    },
    "vitest@1.0.0(@types/node@20.10.0)": {
      dependencies: {
        "@types/node": "20.10.0",
        vite: "5.0.0",
      },
    },
  };

  it("should traverse all snapshots", () => {
    const snapshots: string[] = [];
    const callback: TraversalCallback = (context) => {
      if (context.path.length === 2) {
        snapshots.push(context.key);
      }
    };

    traverseSnapshots(mockSnapshots, callback);

    expect(snapshots).toEqual([
      "express@4.18.2",
      "vitest@1.0.0(@types/node@20.10.0)",
    ]);
  });

  it("should handle stopping traversal", () => {
    const visited: string[] = [];
    const callback: TraversalCallback = (context) => {
      visited.push(context.key);
      if (context.key === "express@4.18.2") {
        return false; // Stop traversal
      }
    };

    traverseSnapshots(mockSnapshots, callback);

    expect(visited).toEqual(["express@4.18.2"]);
  });
});
