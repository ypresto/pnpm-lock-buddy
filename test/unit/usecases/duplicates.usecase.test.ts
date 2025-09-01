import { describe, it, expect } from "vitest";
import { DuplicatesUsecase } from "../../../src/usecases/duplicates.usecase";
import type { PnpmLockfile } from "../../../src/core/lockfile";

describe("DuplicatesUsecase", () => {
  const mockLockfile: PnpmLockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: { react: { specifier: "18.2.0", version: "18.2.0" } },
      },
    },
    packages: {
      "react@18.2.0": { resolution: { integrity: "sha512-react" } },
    },
    snapshots: {
      "react@18.2.0": {},
    },
  };

  describe("packagesExist", () => {
    it("should validate package existence", () => {
      const usecase = new DuplicatesUsecase(mockLockfile);
      const result = usecase.packagesExist(["react", "non-existent"]);

      expect(result.existing).toEqual(["react"]);
      expect(result.missing).toEqual(["non-existent"]);
    });
  });

  describe("findDuplicates", () => {
    it("should find duplicates", () => {
      const usecase = new DuplicatesUsecase(mockLockfile);
      const duplicates = usecase.findDuplicates({ showAll: true });
      expect(Array.isArray(duplicates)).toBe(true);
    });
  });
});
