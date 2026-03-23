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

  describe("ignore filtering", () => {
    // Two projects: apps/web uses react@18.2.0 and react@19.0.0 (duplicate within project),
    // apps/admin uses react@18.2.0 only (not a duplicate on its own).
    // lodash: apps/web uses lodash@4.17.20 and lodash@4.17.21, apps/admin uses lodash@4.17.20 and lodash@4.17.21.
    const multiProjectLockfile: PnpmLockfile = {
      lockfileVersion: "9.0",
      importers: {
        "apps/web": {
          dependencies: {
            react: { specifier: "^18", version: "18.2.0" },
            "ui-lib": { specifier: "1.0.0", version: "1.0.0" },
            lodash: { specifier: "^4", version: "4.17.20" },
            "lodash-wrapper": {
              specifier: "1.0.0",
              version: "1.0.0",
            },
          },
        },
        "apps/admin": {
          dependencies: {
            react: { specifier: "^18", version: "18.2.0" },
            lodash: { specifier: "^4", version: "4.17.20" },
            "lodash-wrapper": {
              specifier: "1.0.0",
              version: "1.0.0",
            },
          },
        },
      },
      packages: {
        "react@18.2.0": { resolution: { integrity: "sha512-r18" } },
        "react@19.0.0": { resolution: { integrity: "sha512-r19" } },
        "ui-lib@1.0.0": { resolution: { integrity: "sha512-ui" } },
        "lodash@4.17.20": { resolution: { integrity: "sha512-l20" } },
        "lodash@4.17.21": { resolution: { integrity: "sha512-l21" } },
        "lodash-wrapper@1.0.0": {
          resolution: { integrity: "sha512-lw" },
        },
      },
      snapshots: {
        "react@18.2.0": {},
        "react@19.0.0": {},
        "ui-lib@1.0.0": { dependencies: { react: "19.0.0" } },
        "lodash@4.17.20": {},
        "lodash@4.17.21": {},
        "lodash-wrapper@1.0.0": { dependencies: { lodash: "4.17.21" } },
      },
    };

    it("findDuplicates: ignoreProjects removes a project, dropping duplicates that become single-instance", async () => {
      const lockfilePath = writeMockLockfile(multiProjectLockfile);
      const usecase = new DuplicatesUsecase(
        lockfilePath,
        multiProjectLockfile,
      );

      // Without ignore: react has 2 instances (18.2.0 used by both projects, 19.0.0 used by apps/web via ui-lib)
      const withoutIgnore = await usecase.findDuplicates({
        packageFilter: ["react"],
      });
      expect(withoutIgnore).toHaveLength(1);
      expect(withoutIgnore[0]!.instances).toHaveLength(2);

      // Ignore apps/web: react@19.0.0 only comes from apps/web (via ui-lib),
      // so after ignoring apps/web, react@19.0.0 has no projects left, leaving only react@18.2.0 -> no duplicate
      const withIgnore = await usecase.findDuplicates({
        packageFilter: ["react"],
        ignoreProjects: ["apps/web"],
      });
      expect(withIgnore).toHaveLength(0);
    });

    it("findDuplicates: ignorePackageProjects only ignores specific package in specific project", async () => {
      const lockfilePath = writeMockLockfile(multiProjectLockfile);
      const usecase = new DuplicatesUsecase(
        lockfilePath,
        multiProjectLockfile,
      );

      // lodash has 2 instances: 4.17.20 (direct in both) and 4.17.21 (via lodash-wrapper in both)
      // Ignoring apps/web:lodash removes apps/web from lodash instances
      // But lodash@4.17.20 still has apps/admin, and lodash@4.17.21 still has apps/admin (via lodash-wrapper)
      // So lodash is still duplicated
      const withIgnore = await usecase.findDuplicates({
        packageFilter: ["lodash"],
        ignorePackageProjects: [{ project: "apps/web", package: "lodash" }],
      });
      expect(withIgnore).toHaveLength(1);
      // apps/web should not appear in any instance's projects
      for (const instance of withIgnore[0]!.instances) {
        expect(instance.projects).not.toContain("apps/web");
      }
    });

    it("findPerProjectDuplicates: ignoreProjects excludes project from results", async () => {
      const lockfilePath = writeMockLockfile(multiProjectLockfile);
      const usecase = new DuplicatesUsecase(
        lockfilePath,
        multiProjectLockfile,
      );

      // Without ignore: apps/web has per-project duplicates (react 18+19, lodash 4.17.20+21)
      const withoutIgnore = await usecase.findPerProjectDuplicates({});
      const webResult = withoutIgnore.find(
        (r) => r.importerPath === "apps/web",
      );
      expect(webResult).toBeDefined();

      // With ignore: apps/web should not appear
      const withIgnore = await usecase.findPerProjectDuplicates({
        ignoreProjects: ["apps/web"],
      });
      const webResultIgnored = withIgnore.find(
        (r) => r.importerPath === "apps/web",
      );
      expect(webResultIgnored).toBeUndefined();
    });

    it("findPerProjectDuplicates: ignorePackageProjects excludes specific package in specific project", async () => {
      const lockfilePath = writeMockLockfile(multiProjectLockfile);
      const usecase = new DuplicatesUsecase(
        lockfilePath,
        multiProjectLockfile,
      );

      // apps/web has react duplicates and lodash duplicates
      const withoutIgnore = await usecase.findPerProjectDuplicates({});
      const webResult = withoutIgnore.find(
        (r) => r.importerPath === "apps/web",
      );
      expect(webResult).toBeDefined();
      expect(
        webResult!.duplicatePackages.find((p) => p.packageName === "react"),
      ).toBeDefined();
      expect(
        webResult!.duplicatePackages.find((p) => p.packageName === "lodash"),
      ).toBeDefined();

      // Ignoring apps/web:react should remove react from apps/web but keep lodash
      // Note: ignorePackageProjects is applied at global level in findDuplicates,
      // removing apps/web from react instances. If react only has instances from apps/web,
      // it becomes non-duplicate globally and won't appear in per-project results for any project.
      const withIgnore = await usecase.findPerProjectDuplicates({
        ignorePackageProjects: [{ project: "apps/web", package: "react" }],
      });
      const webResultIgnored = withIgnore.find(
        (r) => r.importerPath === "apps/web",
      );
      // apps/web should still appear (lodash is still duplicated)
      expect(webResultIgnored).toBeDefined();
      expect(
        webResultIgnored!.duplicatePackages.find(
          (p) => p.packageName === "lodash",
        ),
      ).toBeDefined();
      // react should not appear (no longer a duplicate after ignoring apps/web for react)
      expect(
        webResultIgnored!.duplicatePackages.find(
          (p) => p.packageName === "react",
        ),
      ).toBeUndefined();
    });
  });
});
