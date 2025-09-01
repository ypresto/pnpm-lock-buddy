import { describe, it, expect } from "vitest";
import { packageExists, validatePackages } from "../../../src/core/utils";
import type { PnpmLockfile } from "../../../src/core/lockfile";

describe("utils", () => {
  const mockLockfile: PnpmLockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: {
          express: { specifier: "4.18.2", version: "4.18.2" },
        },
      },
    },
    packages: {
      "express@4.18.2": {
        resolution: { integrity: "sha512-test" },
      },
      "lodash@4.17.21": {
        resolution: { integrity: "sha512-test" },
      },
      "@types/node@20.10.0": {
        resolution: { integrity: "sha512-test" },
      },
    },
  };

  describe("packageExists", () => {
    it("should return true for existing packages", () => {
      expect(packageExists(mockLockfile, "express")).toBe(true);
      expect(packageExists(mockLockfile, "lodash")).toBe(true);
      expect(packageExists(mockLockfile, "@types/node")).toBe(true);
    });

    it("should return true for packages with version", () => {
      expect(packageExists(mockLockfile, "express@4.18.2")).toBe(true);
      expect(packageExists(mockLockfile, "lodash@4.17.21")).toBe(true);
      expect(packageExists(mockLockfile, "@types/node@20.10.0")).toBe(true);
    });

    it("should return false for non-existent packages", () => {
      expect(packageExists(mockLockfile, "non-existent")).toBe(false);
      expect(packageExists(mockLockfile, "@scope/non-existent")).toBe(false);
      expect(packageExists(mockLockfile, "totally-missing")).toBe(false);
    });

    it("should handle scoped packages correctly", () => {
      expect(packageExists(mockLockfile, "@types/node")).toBe(true);
      expect(packageExists(mockLockfile, "@types/non-existent")).toBe(false);
    });
  });

  describe("validatePackages", () => {
    it("should separate existing and missing packages", () => {
      const result = validatePackages(mockLockfile, [
        "express",
        "lodash",
        "non-existent",
        "@types/node",
        "another-missing",
      ]);

      expect(result.existing).toEqual(["express", "lodash", "@types/node"]);
      expect(result.missing).toEqual(["non-existent", "another-missing"]);
    });

    it("should handle empty input", () => {
      const result = validatePackages(mockLockfile, []);

      expect(result.existing).toEqual([]);
      expect(result.missing).toEqual([]);
    });

    it("should handle all existing packages", () => {
      const result = validatePackages(mockLockfile, [
        "express",
        "lodash",
        "@types/node",
      ]);

      expect(result.existing).toEqual(["express", "lodash", "@types/node"]);
      expect(result.missing).toEqual([]);
    });

    it("should handle all missing packages", () => {
      const result = validatePackages(mockLockfile, ["missing1", "missing2"]);

      expect(result.existing).toEqual([]);
      expect(result.missing).toEqual(["missing1", "missing2"]);
    });
  });
});
