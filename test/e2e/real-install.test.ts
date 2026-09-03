/**
 * Real end-to-end coverage: unlike the other test suites, nothing here is a
 * hand-written or synthetic lockfile. This drives a real `pnpm install`
 * with the actual latest pnpm v11 and v12 CLIs (fetched via `pnpm dlx`,
 * independent of this repo's own pinned pnpm) against one workspace fixture
 * that combines several real pnpm features at once — a workspace with
 * multiple projects, a `workspace:*` link, a catalog entry, and peer
 * dependencies — then runs pnpm-lock-buddy against each resulting real
 * `pnpm-lock.yaml` + `node_modules`.
 *
 * This exists because synthetic fixtures encode our own assumptions about
 * what pnpm writes; real installs are the only way to catch a case where
 * that assumption is wrong (as it was for the multi-document lockfile
 * format and the dependency-tree-builder's dedup-stub contract — see
 * CHANGELOG.md). It's excluded from the default `pnpm test` run (see
 * vitest.e2e.config.ts) because it needs network access and is much slower;
 * run it explicitly with `pnpm test:e2e`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { clearLockfileCache, loadLockfile } from "../../src/core/lockfile.js";
import { DuplicatesUsecase } from "../../src/usecases/duplicates.usecase.js";
import {
  realPnpmInstall,
  resolveLatestPnpmVersion,
} from "./helpers/real-pnpm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures/multi-feature-workspace");

interface Installed {
  label: "v11" | "v12";
  pnpmVersion: string;
  dir: string;
}

describe("real pnpm install, v11 and v12", () => {
  let installed: Installed[];

  beforeAll(() => {
    const v11Version = resolveLatestPnpmVersion(11);
    const v12Version = resolveLatestPnpmVersion(12);
    installed = [
      {
        label: "v11",
        pnpmVersion: v11Version,
        dir: realPnpmInstall(FIXTURE_DIR, v11Version),
      },
      {
        label: "v12",
        pnpmVersion: v12Version,
        dir: realPnpmInstall(FIXTURE_DIR, v12Version),
      },
    ];
  }, 300_000);

  afterAll(() => {
    for (const { dir } of installed ?? []) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pnpm v12 writes the multi-document lockfile format for a pinned packageManager, v11 doesn't", () => {
    // Count documents the same way `loadLockfile` does (`yaml.loadAll`,
    // dropping a trailing empty document from a bare trailing `---`), not by
    // re-deriving separator-counting rules that are easy to get subtly
    // wrong (a single-document lockfile has zero leading `---` at all).
    const documentCount = (dir: string): number =>
      yaml
        .loadAll(fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf-8"))
        .filter((doc) => doc != null).length;

    const v11 = installed.find((i) => i.label === "v11")!;
    const v12 = installed.find((i) => i.label === "v12")!;
    expect(documentCount(v11.dir)).toBe(1);
    expect(documentCount(v12.dir)).toBe(2);
  });

  it.each([["v11"], ["v12"]] as const)(
    "detects the real version-fragmentation graph from a %s install",
    async (label) => {
      const { dir } = installed.find((i) => i.label === label)!;
      const lockfilePath = path.join(dir, "pnpm-lock.yaml");
      clearLockfileCache();
      const lockfile = loadLockfile(lockfilePath);
      const usecase = new DuplicatesUsecase(lockfilePath, lockfile);

      const duplicates = await usecase.findDuplicates();
      const byName = new Map(duplicates.map((d) => [d.packageName, d]));

      // Only these two: the workspace-linked plugin (same physical
      // directory for every consumer) and the catalog-pinned commander
      // must NOT show up as false positives.
      expect([...byName.keys()].sort()).toEqual(["is-number", "is-odd"]);

      // is-number is fragmented three ways by real transitive resolution:
      // app-a's own pin (6.0.0), app-b's own pin (7.0.0, also reached via
      // the plugin's own peer resolution), and is-odd@2.0.0's transitive
      // requirement (4.0.0) that neither app's own pin satisfies.
      expect(
        byName
          .get("is-number")!
          .instances.map((i) => i.version)
          .sort(),
      ).toEqual(["4.0.0", "6.0.0", "7.0.0"]);

      const isOdd = byName.get("is-odd")!;
      expect(isOdd.instances.map((i) => i.version).sort()).toEqual([
        "2.0.0",
        "3.0.1",
      ]);
      const isOddByVersion = new Map(
        isOdd.instances.map((i) => [i.version, i]),
      );
      expect(isOddByVersion.get("2.0.0")!.projects).toEqual(["apps/app-a"]);
      expect(isOddByVersion.get("3.0.1")!.projects).toEqual(["apps/app-b"]);
    },
  );
});
