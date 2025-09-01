import { describe, it, expect } from "vitest";
import { ListUsecase } from "../../../src/usecases/list.usecase";
import type { PnpmLockfile } from "../../../src/core/lockfile";

describe("ListUsecase", () => {
  const mockLockfile: PnpmLockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: {
          express: { specifier: "^4.18.0", version: "4.18.2" },
          lodash: { specifier: "4.17.21", version: "4.17.21" },
        },
      },
    },
    packages: {
      "express@4.18.2": { resolution: { integrity: "sha512-test1" } },
      "lodash@4.17.21": { resolution: { integrity: "sha512-test2" } },
    },
  };

  describe("packageExists", () => {
    it("should return true for existing packages", () => {
      const usecase = new ListUsecase(mockLockfile);
      expect(usecase.packageExists("express")).toBe(true);
      expect(usecase.packageExists("lodash")).toBe(true);
    });

    it("should return false for non-existent packages", () => {
      const usecase = new ListUsecase(mockLockfile);
      expect(usecase.packageExists("non-existent")).toBe(false);
    });
  });

  describe("search", () => {
    it("should find packages", () => {
      const usecase = new ListUsecase(mockLockfile);
      const results = usecase.search("express");
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.packageName === "express")).toBe(true);
    });
  });
});
