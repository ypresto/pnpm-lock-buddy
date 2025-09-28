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

  describe("transitive dependency path tracing", () => {
    // Mock lockfile with complex transitive dependencies for testing
    const transitiveMockLockfile: PnpmLockfile = {
      lockfileVersion: "9.0",
      importers: {
        ".": {
          dependencies: {
            // Direct dependency that has transitive deps
            "app-core": { specifier: "1.0.0", version: "1.0.0" },
          },
          devDependencies: {
            // Dev dependency with transitive deps
            "build-tools": { specifier: "2.0.0", version: "2.0.0" },
          },
        },
        "packages/ui": {
          dependencies: {
            react: { specifier: "18.2.0", version: "18.2.0" },
            // Link dependency
            "@my/shared": {
              specifier: "link:../shared",
              version: "link:../shared",
            },
          },
        },
        "packages/shared": {
          dependencies: {
            lodash: { specifier: "4.17.21", version: "4.17.21" },
          },
        },
      },
      packages: {
        "app-core@1.0.0": { resolution: { integrity: "sha512-appcore" } },
        "build-tools@2.0.0": { resolution: { integrity: "sha512-buildtools" } },
        "react@18.2.0": { resolution: { integrity: "sha512-react" } },
        "lodash@4.17.21": { resolution: { integrity: "sha512-lodash" } },
        "ui-lib@3.0.0": { resolution: { integrity: "sha512-uilib" } },
        "utils@1.5.0": { resolution: { integrity: "sha512-utils" } },
        "deep-dep@0.1.0": { resolution: { integrity: "sha512-deepdep" } },
      },
      snapshots: {
        "app-core@1.0.0": {
          dependencies: { "ui-lib": "3.0.0", utils: "1.5.0" },
        },
        "build-tools@2.0.0": {
          dependencies: { utils: "1.5.0" },
        },
        "react@18.2.0": {},
        "lodash@4.17.21": {},
        "ui-lib@3.0.0": {
          dependencies: { "deep-dep": "0.1.0" },
        },
        "utils@1.5.0": {},
        "deep-dep@0.1.0": {},
      },
    };

    describe("getDependencyPath", () => {
      it("should trace single-level transitive dependencies", () => {
        const tracker = new DependencyTracker(transitiveMockLockfile);

        // ui-lib is a transitive dep through app-core
        const path = tracker.getDependencyPath(".", "ui-lib@3.0.0");

        expect(path).toHaveLength(2);
        expect(path[0].package).toBe("app-core@1.0.0");
        expect(path[0].type).toBe("dependencies");
        expect(path[1].package).toBe("ui-lib@3.0.0");
        expect(path[1].type).toBe("dependencies");
      });

      it("should trace multi-level transitive dependencies", () => {
        const tracker = new DependencyTracker(transitiveMockLockfile);

        // deep-dep is transitive through app-core -> ui-lib
        const path = tracker.getDependencyPath(".", "deep-dep@0.1.0");

        expect(path).toHaveLength(3);
        expect(path[0].package).toBe("app-core@1.0.0");
        expect(path[0].type).toBe("dependencies");
        expect(path[1].package).toBe("ui-lib@3.0.0");
        expect(path[1].type).toBe("dependencies");
        expect(path[2].package).toBe("deep-dep@0.1.0");
        expect(path[2].type).toBe("dependencies");
      });

      it("should trace transitive dependencies through dev dependencies", () => {
        const tracker = new DependencyTracker(transitiveMockLockfile);

        // utils comes through build-tools (dev dependency)
        const path = tracker.getDependencyPath(".", "utils@1.5.0");

        // Should find the shortest path (could be through app-core or build-tools)
        expect(path.length).toBeGreaterThanOrEqual(2);
        expect(path[path.length - 1].package).toBe("utils@1.5.0");
      });

      it("should return direct dependency path without transitive tracing", () => {
        const tracker = new DependencyTracker(transitiveMockLockfile);

        // react is direct dependency in packages/ui
        const path = tracker.getDependencyPath("packages/ui", "react@18.2.0");

        expect(path).toHaveLength(1);
        expect(path[0].package).toBe("react@18.2.0");
        expect(path[0].type).toBe("dependencies");
      });

      it("should trace through linked dependencies", () => {
        const tracker = new DependencyTracker(transitiveMockLockfile);

        // lodash comes through the linked @my/shared package
        const path = tracker.getDependencyPath("packages/ui", "lodash@4.17.21");

        expect(path).toHaveLength(2);
        expect(path[0].package).toBe("@my/shared");
        expect(path[0].type).toBe("dependencies");
        expect(path[0].specifier).toBe("link:packages/shared");
        expect(path[1].package).toBe("lodash@4.17.21");
        expect(path[1].type).toBe("dependencies");
      });

      it("should fallback to transitive indicator when path cannot be traced", () => {
        // Create a lockfile with a missing snapshot to simulate untraceable dependency
        const incompletelockfile: PnpmLockfile = {
          lockfileVersion: "9.0",
          importers: {
            ".": {
              dependencies: {
                "mystery-pkg": { specifier: "1.0.0", version: "1.0.0" },
              },
            },
          },
          packages: {
            "mystery-pkg@1.0.0": {
              resolution: { integrity: "sha512-mystery" },
            },
            "unknown@2.0.0": { resolution: { integrity: "sha512-unknown" } },
          },
          snapshots: {
            // Missing snapshot for mystery-pkg, so unknown won't be traceable
            "unknown@2.0.0": {},
          },
        };

        const tracker = new DependencyTracker(incompletelockfile);

        // unknown@2.0.0 exists but has no traceable path
        const path = tracker.getDependencyPath(".", "unknown@2.0.0");

        expect(path).toHaveLength(1);
        expect(path[0].package).toBe("unknown@2.0.0");
        expect(path[0].type).toBe("transitive");
        expect(path[0].specifier).toBe("transitive");
      });

      it("should handle circular dependencies without infinite loops", () => {
        // Create a lockfile with circular dependencies
        const circularLockfile: PnpmLockfile = {
          lockfileVersion: "9.0",
          importers: {
            ".": {
              dependencies: {
                "pkg-a": { specifier: "1.0.0", version: "1.0.0" },
              },
            },
          },
          packages: {
            "pkg-a@1.0.0": { resolution: { integrity: "sha512-pkga" } },
            "pkg-b@1.0.0": { resolution: { integrity: "sha512-pkgb" } },
            "pkg-c@1.0.0": { resolution: { integrity: "sha512-pkgc" } },
          },
          snapshots: {
            "pkg-a@1.0.0": { dependencies: { "pkg-b": "1.0.0" } },
            "pkg-b@1.0.0": { dependencies: { "pkg-c": "1.0.0" } },
            "pkg-c@1.0.0": { dependencies: { "pkg-a": "1.0.0" } }, // Creates cycle
          },
        };

        const tracker = new DependencyTracker(circularLockfile);

        // Should handle circular dependency gracefully
        const path = tracker.getDependencyPath(".", "pkg-c@1.0.0");

        // Should find a path without getting stuck in infinite loop
        expect(path.length).toBeGreaterThan(0);
        expect(path.length).toBeLessThan(10); // Reasonable depth limit
        expect(path[path.length - 1].package).toBe("pkg-c@1.0.0");
      });

      it("should respect max depth limit", () => {
        // Create a very deep dependency chain
        const deepLockfile: PnpmLockfile = {
          lockfileVersion: "9.0",
          importers: {
            ".": {
              dependencies: {
                "level-0": { specifier: "1.0.0", version: "1.0.0" },
              },
            },
          },
          packages: Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `level-${i}@1.0.0`,
              { resolution: { integrity: `sha512-level${i}` } },
            ]),
          ),
          snapshots: Object.fromEntries([
            ...Array.from({ length: 9 }, (_, i) => [
              `level-${i}@1.0.0`,
              { dependencies: { [`level-${i + 1}`]: "1.0.0" } },
            ]),
            ["level-9@1.0.0", {}], // Final level has no dependencies
          ]),
        };

        const tracker = new DependencyTracker(deepLockfile);

        // Should find path to deep dependency but respect depth limit
        const path = tracker.getDependencyPath(".", "level-9@1.0.0");

        // Path should be found but not exceed reasonable depth
        expect(path.length).toBeGreaterThan(0);
        expect(path.length).toBeLessThanOrEqual(10); // Default maxDepth is 10
      });
    });

    describe("workspace packages with peer dependency variants", () => {
      it("should show complete transitive path through intermediate packages with matching peer context", async () => {
        const yaml = await import("js-yaml");
        const fs = await import("fs");
        const path = await import("path");

        const fixturePath = path.join(__dirname, "../../fixtures/workspace-peer-variants.yaml");
        const fixtureContent = fs.readFileSync(fixturePath, "utf-8");
        const lockfile = yaml.load(fixtureContent) as PnpmLockfile;

        const tracker = new DependencyTracker(lockfile, path.join(__dirname, "../../fixtures"));

        const depPath = tracker.getDependencyPath(
          "packages/webapp/ui-react",
          "react-dom@18.2.0(react@18.2.0)"
        );

        expect(depPath.length).toBeGreaterThanOrEqual(2);
        expect(depPath[0].package).toContain("@floating-ui/react");
        expect(depPath[0].package).toContain("react@18.2.0");
        expect(depPath[depPath.length - 1].package).toBe("react-dom@18.2.0(react@18.2.0)");
      });
    });
  });
});
