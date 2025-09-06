import { describe, it, expect } from "vitest";
import { DependencyTracker } from "../../../src/core/dependency-tracker";
import type { PnpmLockfile } from "../../../src/core/lockfile";

describe("DependencyTracker", () => {
  const mockLockfile: PnpmLockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: {
          express: { specifier: "^4.18.0", version: "4.18.2" },
          lodash: { specifier: "4.17.21", version: "4.17.21" },
        },
      },
      "packages/app": {
        dependencies: {
          react: { specifier: "18.2.0", version: "18.2.0" },
        },
        devDependencies: {
          vitest: {
            specifier: "^1.0.0",
            version: "1.0.0(@types/node@20.10.0)",
          },
        },
      },
    },
    packages: {
      "express@4.18.2": {
        resolution: { integrity: "sha512-express" },
        dependencies: { "body-parser": "1.20.0", cookie: "0.5.0" },
      },
      "lodash@4.17.21": {
        resolution: { integrity: "sha512-lodash" },
      },
      "react@18.2.0": {
        resolution: { integrity: "sha512-react" },
        dependencies: { "loose-envify": "1.4.0" },
      },
      "body-parser@1.20.0": {
        resolution: { integrity: "sha512-bodyparser" },
        dependencies: { bytes: "3.1.2" },
      },
      "cookie@0.5.0": {
        resolution: { integrity: "sha512-cookie" },
      },
      "loose-envify@1.4.0": {
        resolution: { integrity: "sha512-looseenvify" },
      },
      "bytes@3.1.2": {
        resolution: { integrity: "sha512-bytes" },
      },
      "vitest@1.0.0": {
        resolution: { integrity: "sha512-vitest" },
        peerDependencies: { "@types/node": "*" },
      },
    },
    snapshots: {
      "express@4.18.2": {
        dependencies: { "body-parser": "1.20.0", cookie: "0.5.0" },
      },
      "lodash@4.17.21": {},
      "react@18.2.0": {
        dependencies: { "loose-envify": "1.4.0" },
      },
      "body-parser@1.20.0": {
        dependencies: { bytes: "3.1.2" },
      },
      "cookie@0.5.0": {},
      "loose-envify@1.4.0": {},
      "bytes@3.1.2": {},
      "vitest@1.0.0(@types/node@20.10.0)": {
        dependencies: { "@types/node": "20.10.0" },
      },
    },
  };

  describe("getImportersForPackage", () => {
    it("should find direct importers", () => {
      const tracker = new DependencyTracker(mockLockfile);

      const expressImporters = tracker.getImportersForPackage("express@4.18.2");
      expect(expressImporters).toContain(".");

      const reactImporters = tracker.getImportersForPackage("react@18.2.0");
      expect(reactImporters).toContain("packages/app");
    });

    it("should find transitive importers", () => {
      const tracker = new DependencyTracker(mockLockfile);

      // body-parser is a transitive dependency of express, which is used by root
      const bodyParserImporters =
        tracker.getImportersForPackage("body-parser@1.20.0");
      expect(bodyParserImporters).toContain(".");

      // bytes is a transitive dependency of body-parser -> express -> root
      const bytesImporters = tracker.getImportersForPackage("bytes@3.1.2");
      expect(bytesImporters).toContain(".");

      // loose-envify is a transitive dependency of react, which is used by packages/app
      const looseEnvifyImporters =
        tracker.getImportersForPackage("loose-envify@1.4.0");
      expect(looseEnvifyImporters).toContain("packages/app");
    });

    it("should handle packages with peer dependencies", () => {
      const tracker = new DependencyTracker(mockLockfile);

      const vitestImporters = tracker.getImportersForPackage(
        "vitest@1.0.0(@types/node@20.10.0)",
      );
      expect(vitestImporters).toContain("packages/app");
    });

    it("should return empty array for non-existent package", () => {
      const tracker = new DependencyTracker(mockLockfile);

      const nonExistentImporters =
        tracker.getImportersForPackage("non-existent@1.0.0");
      expect(nonExistentImporters).toEqual([]);
    });

    it("should return sorted results", () => {
      const complexLockfile: PnpmLockfile = {
        ...mockLockfile,
        importers: {
          "packages/z-app": {
            dependencies: { shared: { specifier: "1.0.0", version: "1.0.0" } },
          },
          "packages/a-app": {
            dependencies: { shared: { specifier: "1.0.0", version: "1.0.0" } },
          },
          "packages/m-app": {
            dependencies: { shared: { specifier: "1.0.0", version: "1.0.0" } },
          },
        },
        packages: {
          "shared@1.0.0": { resolution: { integrity: "sha512-shared" } },
        },
        snapshots: {
          "shared@1.0.0": {},
        },
      };

      const tracker = new DependencyTracker(complexLockfile);
      const importers = tracker.getImportersForPackage("shared@1.0.0");

      expect(importers).toEqual([
        "packages/a-app",
        "packages/m-app",
        "packages/z-app",
      ]);
    });
  });

  describe("getDirectDependentsForPackage", () => {
    it("should find packages that directly depend on a given package", () => {
      const tracker = new DependencyTracker(mockLockfile);

      const bodyParserDependents =
        tracker.getDirectDependentsForPackage("body-parser@1.20.0");
      expect(bodyParserDependents).toContain("express@4.18.2");

      const bytesDependents =
        tracker.getDirectDependentsForPackage("bytes@3.1.2");
      expect(bytesDependents).toContain("body-parser@1.20.0");
    });

    it("should return empty array for packages with no dependents", () => {
      const tracker = new DependencyTracker(mockLockfile);

      const lodashDependents =
        tracker.getDirectDependentsForPackage("lodash@4.17.21");
      expect(lodashDependents).toEqual([]);
    });
  });

  describe("isPackageUsed", () => {
    it("should return true for packages used by importers", () => {
      const tracker = new DependencyTracker(mockLockfile);

      expect(tracker.isPackageUsed("express@4.18.2")).toBe(true);
      expect(tracker.isPackageUsed("body-parser@1.20.0")).toBe(true); // transitive
      expect(tracker.isPackageUsed("react@18.2.0")).toBe(true);
    });

    it("should return false for unused packages", () => {
      const tracker = new DependencyTracker(mockLockfile);

      expect(tracker.isPackageUsed("non-existent@1.0.0")).toBe(false);
    });
  });

  describe("caching behavior", () => {
    it("should cache results and return same array reference on subsequent calls", () => {
      const tracker = new DependencyTracker(mockLockfile);

      // First call should initialize and compute
      const result1 = tracker.getImportersForPackage("express@4.18.2");

      // Second call should use cached results
      const result2 = tracker.getImportersForPackage("express@4.18.2");

      expect(result1).toEqual(result2);
      expect(result1).toBe(result2); // Same array reference due to caching
    });
  });

  describe("linked dependencies", () => {
    const linkedMockLockfile: PnpmLockfile = {
      lockfileVersion: "9.0",
      importers: {
        ".": {
          dependencies: {
            express: { specifier: "^4.18.0", version: "4.18.2" },
          },
        },
        "apps/web": {
          dependencies: {
            "@my/logger": {
              specifier: "link:../../packages/logger",
              version: "link:../../packages/logger",
            },
            react: { specifier: "18.2.0", version: "18.2.0" },
          },
        },
        "packages/logger": {
          dependencies: {
            lodash: { specifier: "4.17.21", version: "4.17.21" },
            chalk: { specifier: "^5.0.0", version: "5.0.0" },
          },
        },
      },
      packages: {
        "express@4.18.2": {
          resolution: { integrity: "sha512-express" },
        },
        "react@18.2.0": {
          resolution: { integrity: "sha512-react" },
        },
        "lodash@4.17.21": {
          resolution: { integrity: "sha512-lodash" },
        },
        "chalk@5.0.0": {
          resolution: { integrity: "sha512-chalk" },
        },
      },
      snapshots: {
        "express@4.18.2": {},
        "react@18.2.0": {},
        "lodash@4.17.21": {},
        "chalk@5.0.0": {},
      },
    };

    it("should resolve linked dependencies and include transitive dependencies", () => {
      const tracker = new DependencyTracker(linkedMockLockfile);

      // apps/web should have access to lodash and chalk through the linked @my/logger
      const lodashImporters = tracker.getImportersForPackage("lodash@4.17.21");
      expect(lodashImporters).toContain("apps/web");

      const chalkImporters = tracker.getImportersForPackage("chalk@5.0.0");
      expect(chalkImporters).toContain("apps/web");

      // packages/logger should also have access to its direct dependencies
      expect(lodashImporters).toContain("packages/logger");
      expect(chalkImporters).toContain("packages/logger");
    });

    it("should track linked dependency information", () => {
      const tracker = new DependencyTracker(linkedMockLockfile);

      const linkedDeps = tracker.getLinkedDependencies("apps/web");
      expect(linkedDeps).toHaveLength(1);
      expect(linkedDeps[0]).toEqual({
        sourceImporter: "apps/web",
        linkName: "@my/logger",
        resolvedImporter: "packages/logger",
      });
    });

    it("should handle multiple linked dependencies", () => {
      const multiLinkedLockfile: PnpmLockfile = {
        ...linkedMockLockfile,
        importers: {
          ...linkedMockLockfile.importers,
          "apps/web": {
            dependencies: {
              "@my/logger": {
                specifier: "link:../../packages/logger",
                version: "link:../../packages/logger",
              },
              "@my/utils": {
                specifier: "link:../../packages/utils",
                version: "link:../../packages/utils",
              },
            },
          },
          "packages/utils": {
            dependencies: {
              ramda: { specifier: "0.29.0", version: "0.29.0" },
            },
          },
        },
        packages: {
          ...linkedMockLockfile.packages,
          "ramda@0.29.0": { resolution: { integrity: "sha512-ramda" } },
        },
        snapshots: {
          ...linkedMockLockfile.snapshots,
          "ramda@0.29.0": {},
        },
      };

      const tracker = new DependencyTracker(multiLinkedLockfile);

      // apps/web should have access to dependencies from both linked packages
      const ramdalImporters = tracker.getImportersForPackage("ramda@0.29.0");
      expect(ramdalImporters).toContain("apps/web");

      const lodashImporters = tracker.getImportersForPackage("lodash@4.17.21");
      expect(lodashImporters).toContain("apps/web");

      // Check linked dependency tracking
      const linkedDeps = tracker.getLinkedDependencies("apps/web");
      expect(linkedDeps).toHaveLength(2);
      expect(linkedDeps.map((dep) => dep.linkName)).toContain("@my/logger");
      expect(linkedDeps.map((dep) => dep.linkName)).toContain("@my/utils");
    });

    it("should return empty array for importers without linked dependencies", () => {
      const tracker = new DependencyTracker(linkedMockLockfile);

      const linkedDeps = tracker.getLinkedDependencies(".");
      expect(linkedDeps).toEqual([]);
    });
  });
});
