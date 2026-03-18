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

  // Regression: same version with different peer deps should be detected as duplicates.
  // This reproduces the next-navigation-guard dual-instance issue where @babel/core
  // version differences caused two separate instances of the same package.
  describe("findDuplicates with same version different peer deps", () => {
    const peerDupLockfile: PnpmLockfile = {
      lockfileVersion: "9.0",
      importers: {
        ".": {
          dependencies: {
            "pkg-a": {
              specifier: "1.0.0",
              version:
                "1.0.0(framework@2.0.0(compiler@3.0.0))(runtime@4.0.0)",
            },
            "pkg-b": {
              specifier: "1.0.0",
              version:
                "1.0.0(framework@2.0.0(compiler@3.1.0))(runtime@4.0.0)",
            },
          },
        },
      },
      packages: {
        "pkg-a@1.0.0": { resolution: { integrity: "sha512-a" } },
        "pkg-b@1.0.0": { resolution: { integrity: "sha512-b" } },
        "shared@1.0.0": { resolution: { integrity: "sha512-shared" } },
      },
      snapshots: {
        "pkg-a@1.0.0(framework@2.0.0(compiler@3.0.0))(runtime@4.0.0)": {
          dependencies: {
            shared:
              "1.0.0(framework@2.0.0(compiler@3.0.0))(runtime@4.0.0)",
          },
        },
        "pkg-b@1.0.0(framework@2.0.0(compiler@3.1.0))(runtime@4.0.0)": {
          dependencies: {
            shared:
              "1.0.0(framework@2.0.0(compiler@3.1.0))(runtime@4.0.0)",
          },
        },
        "shared@1.0.0(framework@2.0.0(compiler@3.0.0))(runtime@4.0.0)": {},
        "shared@1.0.0(framework@2.0.0(compiler@3.1.0))(runtime@4.0.0)": {},
      },
    };

    it("should detect global duplicates for same version with different peer deps", async () => {
      const lockfilePath = writeMockLockfile(peerDupLockfile);
      const usecase = new DuplicatesUsecase(lockfilePath, peerDupLockfile);
      const duplicates = await usecase.findDuplicates({
        packageFilter: ["shared"],
      });

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]!.packageName).toBe("shared");
      expect(duplicates[0]!.instances).toHaveLength(2);
      expect(duplicates[0]!.instances[0]!.id).not.toBe(
        duplicates[0]!.instances[1]!.id,
      );
    });

    it("should detect per-project duplicates for same version with different peer deps", async () => {
      const lockfilePath = writeMockLockfile(peerDupLockfile);
      const usecase = new DuplicatesUsecase(lockfilePath, peerDupLockfile);
      const perProject = await usecase.findPerProjectDuplicates({
        packageFilter: ["shared"],
      });

      expect(perProject).toHaveLength(1);
      expect(perProject[0]!.importerPath).toBe(".");
      const sharedDup = perProject[0]!.duplicatePackages.find(
        (p) => p.packageName === "shared",
      );
      expect(sharedDup).toBeDefined();
      expect(sharedDup!.instances).toHaveLength(2);
    });
  });
});
