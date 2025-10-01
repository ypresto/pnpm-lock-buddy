import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DuplicatesUsecase } from "../../../src/usecases/duplicates.usecase";
import type { PnpmLockfile } from "../../../src/core/lockfile";
import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pnpm-lock-buddy-usecase-test-"),
  );
});

afterAll(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
});

function writeMockLockfile(lockfile: PnpmLockfile): string {
  const filePath = path.join(tempDir, `lock-${Date.now()}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(lockfile), "utf-8");
  return filePath;
}

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
      const lockfilePath = writeMockLockfile(mockLockfile);
      const usecase = new DuplicatesUsecase(lockfilePath, mockLockfile);
      const result = usecase.packagesExist(["react", "non-existent"]);

      expect(result.existing).toEqual(["react"]);
      expect(result.missing).toEqual(["non-existent"]);
    });
  });

  describe("findDuplicates", () => {
    it("should find duplicates", async () => {
      const lockfilePath = writeMockLockfile(mockLockfile);
      const usecase = new DuplicatesUsecase(lockfilePath, mockLockfile);
      const duplicates = await usecase.findDuplicates({ showAll: true });
      expect(Array.isArray(duplicates)).toBe(true);
    });
  });
});
