import { describe, it, expect } from "vitest";
import {
  packageExists,
  validatePackages,
  matchesWildcard,
  matchesAnyWildcard,
} from "../../../src/core/utils";
import type { PnpmLockfile } from "../../../src/core/lockfile";

describe("utils", () => {
  const mockLockfile: PnpmLockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: {
          express: { specifier: "4.18.2", version: "4.18.2" },
          lodash: { specifier: "4.17.21", version: "4.17.21" },
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
    },
  };

  describe("packageExists", () => {
    it("should return true for existing packages", () => {
      expect(packageExists(mockLockfile, "express")).toBe(true);
      expect(packageExists(mockLockfile, "lodash")).toBe(true);
      expect(packageExists(mockLockfile, "express@4.18.2")).toBe(true);
    });

    it("should return false for non-existing packages", () => {
      expect(packageExists(mockLockfile, "react")).toBe(false);
      expect(packageExists(mockLockfile, "non-existent@1.0.0")).toBe(false);
    });
  });

  describe("validatePackages", () => {
    it("should categorize existing and missing packages", () => {
      const result = validatePackages(mockLockfile, [
        "express",
        "lodash",
        "react",
        "non-existent",
      ]);

      expect(result.existing).toEqual(["express", "lodash"]);
      expect(result.missing).toEqual(["react", "non-existent"]);
    });
  });

  describe("matchesWildcard", () => {
    it("should match exact patterns", () => {
      expect(matchesWildcard("react", "react")).toBe(true);
      expect(matchesWildcard("react", "lodash")).toBe(false);
    });

    it("should match wildcard patterns", () => {
      expect(matchesWildcard("react", "react*")).toBe(true);
      expect(matchesWildcard("react-dom", "react*")).toBe(true);
      expect(matchesWildcard("react-scripts", "react*")).toBe(true);
      expect(matchesWildcard("lodash", "react*")).toBe(false);
    });

    it("should match @types/* patterns", () => {
      expect(matchesWildcard("@types/node", "@types/*")).toBe(true);
      expect(matchesWildcard("@types/react", "@types/*")).toBe(true);
      expect(matchesWildcard("@babel/core", "@types/*")).toBe(false);
    });

    it("should match *eslint* patterns", () => {
      expect(matchesWildcard("eslint", "*eslint*")).toBe(true);
      expect(matchesWildcard("@typescript-eslint/parser", "*eslint*")).toBe(
        true,
      );
      expect(matchesWildcard("eslint-config-prettier", "*eslint*")).toBe(true);
      expect(matchesWildcard("react", "*eslint*")).toBe(false);
    });

    it("should handle complex patterns", () => {
      expect(matchesWildcard("@babel/preset-env", "@babel/*")).toBe(true);
      expect(matchesWildcard("babel-loader", "*babel*")).toBe(true);
      expect(matchesWildcard("webpack-babel-plugin", "*babel*")).toBe(true);
    });
  });

  describe("matchesAnyWildcard", () => {
    it("should match if any pattern matches", () => {
      const patterns = ["react*", "@types/*", "*eslint*"];

      expect(matchesAnyWildcard("react", patterns)).toBe(true);
      expect(matchesAnyWildcard("@types/node", patterns)).toBe(true);
      expect(matchesAnyWildcard("eslint", patterns)).toBe(true);
      expect(matchesAnyWildcard("@typescript-eslint/parser", patterns)).toBe(
        true,
      );
      expect(matchesAnyWildcard("lodash", patterns)).toBe(false);
    });
  });
});
